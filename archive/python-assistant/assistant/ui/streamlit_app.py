"""Aurora web UI: a chat with your assistant, next to a live Spotify remote.

Run with:  streamlit run assistant/ui/streamlit_app.py

Layout:
  left   now playing (cover art, progress, controls), up next, and a quick
         search with Play/Queue buttons. These call Spotify directly, without
         the LLM, so they're instant and cost nothing.
  right  the chat. Each answer shows which tools ran. Risky actions show
         Approve/Cancel buttons and wait for a click (see safety.BlockingConfirmer).

Audio still plays through the user's own Spotify app or device. Aurora is a
remote control with an assistant built in, not a replacement player (Spotify's
developer policy forbids replicating Spotify's core experience).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import anthropic
import streamlit as st

from assistant.agent import Agent, AgentReply
from assistant.clients.spotify_client import SpotifyClient
from assistant.config import ConfigError, Settings, load_settings
from assistant.errors import ToolError
from assistant.llm import AnthropicLLM, explain_api_error
from assistant.safety import BlockingConfirmer
from assistant.tools import build_registry
from assistant.ui.background import BackgroundTurn

NOW_PLAYING_REFRESH_SECONDS = 8  # polling costs Spotify quota; this is a gentle rate
EXAMPLES = [
    "What's playing?",
    "Play something chill",
    "Who are my top artists this month?",
    "Make me a 20-song gym playlist from what I've been listening to",
]

st.set_page_config(page_title="Aurora", page_icon="🎧", layout="wide")


# ------------------------------------------------------------------ session

@dataclass
class Session:
    """Everything that must survive Streamlit's rerun-the-script-on-every-click model."""

    settings: Settings
    agent: Agent
    confirmer: BlockingConfirmer
    spotify: SpotifyClient | None
    transcript: list[dict[str, Any]] = field(default_factory=list)
    turn: BackgroundTurn | None = None
    search_results: list[dict[str, Any]] = field(default_factory=list)


def connect_spotify(settings: Settings) -> SpotifyClient | None:
    if not settings.spotify_configured:
        return None
    client = SpotifyClient.from_settings(settings)
    with st.spinner("Connecting to Spotify. Approve access in the browser tab that opens (first run only)..."):
        client.ensure_logged_in()
    return client


def get_session() -> Session:
    # st.session_state is per browser tab, so each tab gets its own conversation.
    if "aurora" not in st.session_state:
        try:
            settings = load_settings()
        except ConfigError as exc:
            st.error(f"Config error: {exc}")
            st.stop()
        try:
            spotify = connect_spotify(settings)
        except ToolError as exc:
            st.warning(f"{exc} Continuing without Spotify.")
            spotify = None
        confirmer = BlockingConfirmer()
        registry = build_registry(
            settings.tz,
            spotify=spotify,
            confirmer=confirmer,
            playlist_confirm_threshold=settings.playlist_confirm_threshold,
        )
        agent = Agent(
            AnthropicLLM(settings),
            registry,
            timezone=settings.timezone,
            max_tool_iterations=settings.max_tool_iterations,
        )
        st.session_state.aurora = Session(settings, agent, confirmer, spotify)
    return st.session_state.aurora


def submit(session: Session, text: str) -> None:
    session.transcript.append({"role": "user", "text": text})
    session.turn = BackgroundTurn(session.agent, text)


# ------------------------------------------------------------ left: Spotify

def _mmss(ms: int) -> str:
    seconds = int(ms) // 1000
    return f"{seconds // 60}:{seconds % 60:02d}"


def _spotify_action(fn, *args) -> None:
    """Run a direct Spotify command from a button, showing errors as a toast."""
    try:
        fn(*args)
    except ToolError as exc:
        st.toast(str(exc), icon="⚠️")


@st.fragment(run_every=NOW_PLAYING_REFRESH_SECONDS)
def now_playing_panel(spotify: SpotifyClient) -> None:
    # A fragment re-runs on its own timer without re-running the whole page,
    # so the progress bar stays live while you chat.
    try:
        np = spotify.now_playing()
    except ToolError as exc:
        st.info(str(exc))
        np = None

    if np:
        if np["image_url"]:
            st.image(np["image_url"], width="stretch")
        title = f"[{np['name']}]({np['spotify_url']})" if np["spotify_url"] else np["name"]
        st.markdown(f"**{title}**  \n{np['subtitle'] or ''}")
        if np["duration_ms"]:
            st.progress(min(np["progress_ms"] / np["duration_ms"], 1.0),
                        text=f"{_mmss(np['progress_ms'])} / {_mmss(np['duration_ms'])}")
        if np["device"]:
            st.caption(f"On {np['device']}")
    else:
        st.caption("Nothing playing. Open Spotify on a device, or ask Aurora to play something.")

    prev_col, play_col, next_col = st.columns(3)
    playing = bool(np and np["is_playing"])
    if prev_col.button("⏮", width="stretch", help="Previous"):
        _spotify_action(spotify.skip_previous)
    if play_col.button("⏸" if playing else "▶", width="stretch", help="Pause" if playing else "Play"):
        _spotify_action(spotify.pause if playing else spotify.play)
    if next_col.button("⏭", width="stretch", help="Next"):
        _spotify_action(spotify.skip_next)

    try:
        queue = spotify.up_next()
    except ToolError:
        queue = []
    if queue:
        st.markdown("**Up next**")
        for item in queue:
            st.caption(f"{item['name']} · {item['subtitle']}")


def quick_search(session: Session, spotify: SpotifyClient) -> None:
    with st.expander("Quick search (no AI, instant)"):
        with st.form("quick_search", clear_on_submit=False, border=False):
            query = st.text_input("Song or artist", label_visibility="collapsed", placeholder="Song or artist")
            if st.form_submit_button("Search") and query.strip():
                try:
                    session.search_results = spotify.search(query.strip(), ["track"], limit=8)["tracks"]
                except ToolError as exc:
                    st.toast(str(exc), icon="⚠️")
        for i, track in enumerate(session.search_results):
            info, play_col, queue_col = st.columns([6, 1, 1])
            info.markdown(f"{track['name']}  \n:gray[{', '.join(track['artists'])}]")
            if play_col.button("▶", key=f"play_{i}", help="Play now"):
                _spotify_action(spotify.play, [track["uri"]])
            if queue_col.button("➕", key=f"queue_{i}", help="Add to queue"):
                _spotify_action(spotify.add_to_queue, track["uri"])
                st.toast(f"Queued {track['name']}")


# --------------------------------------------------------------- right: chat

def render_message(message: dict[str, Any]) -> None:
    with st.chat_message(message["role"]):
        st.markdown(message["text"])
        reply: AgentReply | None = message.get("reply")
        if reply is None:
            return
        if reply.tool_calls:
            with st.expander(f"🔧 {len(reply.tool_calls)} tool call(s)"):
                for call in reply.tool_calls:
                    badge = ":orange[declined]" if call.declined else (":red[error]" if call.is_error else ":green[ok]")
                    st.markdown(f"`{call.name}` {badge} · {call.latency_ms:.0f} ms")
                    st.code(json.dumps(call.arguments, indent=1, ensure_ascii=False), language="json")
        st.caption(
            f"{reply.latency_ms / 1000:.1f}s · {reply.model_calls} model call(s) · "
            f"{reply.usage.input_tokens:,} in / {reply.usage.output_tokens:,} out tokens"
        )


@st.fragment(run_every=0.5)
def turn_in_progress(session: Session) -> None:
    turn = session.turn
    if turn is None:
        return

    if turn.done:
        if turn.error is not None:
            if isinstance(turn.error, anthropic.APIError):
                text = f"⚠️ {explain_api_error(turn.error)}"
            else:
                text = f"⚠️ Something went wrong: {turn.error}"
            session.transcript.append({"role": "assistant", "text": text})
        else:
            session.transcript.append({"role": "assistant", "text": turn.reply.text, "reply": turn.reply})
        session.turn = None
        st.rerun(scope="app")  # re-render the transcript and re-enable the input

    action = session.confirmer.pending
    with st.chat_message("assistant"):
        if action is None:
            st.markdown("_Working on it..._")
            return
        # The agent thread is blocked inside the confirmer until one of these is clicked.
        with st.container(border=True):
            st.markdown(f"**Confirm:** {action.summary}")
            if action.details:
                st.markdown("\n".join(f"{i}. {line}" for i, line in enumerate(action.details, 1)))
            approve_col, cancel_col, _ = st.columns([1, 1, 4])
            if approve_col.button("Approve", type="primary", key="approve"):
                session.confirmer.resolve(True)
            if cancel_col.button("Cancel", key="cancel"):
                session.confirmer.resolve(False)


def chat_panel(session: Session) -> None:
    if not session.transcript and session.turn is None:
        st.markdown("#### What can I do for you?")
        cols = st.columns(len(EXAMPLES))
        for col, example in zip(cols, EXAMPLES):
            if col.button(example, width="stretch"):
                submit(session, example)
                st.rerun()

    for message in session.transcript:
        render_message(message)
    turn_in_progress(session)

    busy = session.turn is not None
    text = st.chat_input("Ask Aurora... (e.g. 'play Teardrop by Massive Attack')", disabled=busy)
    if text:
        submit(session, text)
        st.rerun()


# --------------------------------------------------------------------- page

def main() -> None:
    session = get_session()

    with st.sidebar:
        st.markdown("## 🎧 Aurora")
        st.caption(f"Model: `{session.settings.model}`")
        if st.button("New conversation", disabled=session.turn is not None, width="stretch"):
            session.agent.reset()
            session.transcript.clear()
            st.rerun()
        st.divider()
        st.caption("Music data and artwork provided by Spotify.")

    left, right = st.columns([1, 2], gap="large")
    with left:
        if session.spotify is None:
            st.info("Spotify isn't connected. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env and restart.")
        else:
            now_playing_panel(session.spotify)
            quick_search(session, session.spotify)
    with right:
        chat_panel(session)


main()
