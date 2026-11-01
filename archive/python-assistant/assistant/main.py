"""Command-line chat interface.

Run with:  python -m assistant.main   (or `aurora` after `pip install -e .`)
"""

from __future__ import annotations

import json
import logging
import sys

import anthropic
from rich.console import Console
from rich.markdown import Markdown
from rich.markup import escape
from rich.panel import Panel
from rich.status import Status

from assistant.agent import Agent, AgentReply
from assistant.clients.spotify_client import SpotifyClient
from assistant.config import ConfigError, Settings, load_settings
from assistant.errors import ToolError
from assistant.llm import AnthropicLLM, explain_api_error
from assistant.safety import PendingAction
from assistant.tools import build_registry

console = Console()

HELP_TEXT = """[bold]Commands[/bold]
  /reset   start a new conversation
  /help    show this message
  /quit    exit (or Ctrl+C)"""


def connect_spotify(settings: Settings) -> SpotifyClient | None:
    if not settings.spotify_configured:
        console.print("[dim]Spotify not configured (set SPOTIFY_CLIENT_ID/SECRET in .env); music tools disabled.[/dim]")
        return None
    client = SpotifyClient.from_settings(settings)
    try:
        # Log in up front: if a browser login is needed, it happens here and not
        # in the middle of answering a request.
        console.print("[dim]Connecting to Spotify (a browser window opens on first run)...[/dim]")
        client.ensure_logged_in()
    except ToolError as exc:
        console.print(f"[red]{exc}[/red] Continuing without Spotify.")
        return None
    console.print("[green]Spotify connected.[/green]")
    return client


class CliConfirmer:
    """Shows exactly what a risky action will do and waits for an explicit y/n.

    Only "y" or "yes" approves. Anything else, including just pressing Enter,
    counts as no, so the safe answer is also the default one.
    """

    def __init__(self) -> None:
        self.status: Status | None = None  # the spinner, paused while we ask

    def __call__(self, action: PendingAction) -> bool:
        if self.status:
            self.status.stop()
        try:
            lines = [f"[bold]{escape(action.summary)}[/bold]"]
            lines += [f"  {i}. {escape(line)}" for i, line in enumerate(action.details, 1)]
            body = "\n".join(lines)
            console.print(Panel(body, title="Confirm action", title_align="left", border_style="yellow"))
            try:
                answer = console.input("[yellow]Go ahead? [y/N] [/yellow]").strip().lower()
            except (KeyboardInterrupt, EOFError):
                answer = ""
            approved = answer in ("y", "yes")
            console.print("[green]Approved.[/green]" if approved else "[dim]Cancelled - nothing was changed.[/dim]")
            return approved
        finally:
            if self.status:
                self.status.start()


def build_agent(settings: Settings, confirmer: CliConfirmer) -> Agent:
    return Agent(
        AnthropicLLM(settings),
        build_registry(
            settings.tz,
            spotify=connect_spotify(settings),
            confirmer=confirmer,
            playlist_confirm_threshold=settings.playlist_confirm_threshold,
        ),
        timezone=settings.timezone,
        max_tool_iterations=settings.max_tool_iterations,
    )


def render_reply(reply: AgentReply) -> None:
    for call in reply.tool_calls:
        # escape(): track names like "Song [Remix]" would otherwise be parsed as rich markup.
        args = escape(json.dumps(call.arguments, ensure_ascii=False))
        if call.declined:
            status = "[yellow]declined[/yellow]"
        else:
            status = "[red]error[/red]" if call.is_error else "[green]ok[/green]"
        console.print(f"  [dim]tool[/dim] [cyan]{call.name}[/cyan][dim]({args})[/dim] {status} "
                      f"[dim]{call.latency_ms:.0f} ms[/dim]")
    console.print(Panel(Markdown(reply.text), title="Aurora", title_align="left", border_style="magenta"))
    console.print(
        f"[dim]{reply.latency_ms / 1000:.1f}s - {reply.model_calls} model call(s) - "
        f"{reply.usage.input_tokens} in / {reply.usage.output_tokens} out tokens"
        + (f" - stopped: {reply.stop_reason}" if reply.stop_reason != "end_turn" else "")
        + "[/dim]"
    )


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as exc:
        console.print(f"[red]Config error:[/red] {exc}")
        return 1

    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s: %(message)s")
    confirmer = CliConfirmer()
    agent = build_agent(settings, confirmer)

    console.print(f"[bold magenta]Aurora[/bold magenta] [dim]({settings.model})[/dim] - type /help for commands")
    while True:
        try:
            user_input = console.input("[bold]you > [/bold]").strip()
        except (KeyboardInterrupt, EOFError):
            console.print()
            return 0

        if not user_input:
            continue
        if user_input in ("/quit", "/exit"):
            return 0
        if user_input == "/help":
            console.print(HELP_TEXT)
            continue
        if user_input == "/reset":
            agent.reset()
            console.print("[dim]Conversation cleared.[/dim]")
            continue

        try:
            with console.status("Thinking...", spinner="dots") as status:
                confirmer.status = status
                reply = agent.run(user_input)
        except anthropic.APIError as exc:
            console.print(f"[red]{escape(explain_api_error(exc))}[/red]")
            continue
        except KeyboardInterrupt:
            console.print("[dim]Cancelled.[/dim]")
            continue
        render_reply(reply)


if __name__ == "__main__":
    sys.exit(main())
