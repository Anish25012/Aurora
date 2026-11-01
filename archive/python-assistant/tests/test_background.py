"""BlockingConfirmer and BackgroundTurn: the threading behind the web UI's buttons."""

from __future__ import annotations

import threading

from assistant.safety import BlockingConfirmer, PendingAction
from assistant.ui.background import BackgroundTurn

ACTION = PendingAction("create_playlist", "Create playlist 'Gym' with 20 tracks")


def ask_in_thread(confirmer: BlockingConfirmer) -> dict:
    result: dict = {}
    thread = threading.Thread(target=lambda: result.update(answer=confirmer(ACTION)))
    thread.start()
    for _ in range(100):
        if confirmer.pending:
            break
        threading.Event().wait(0.01)
    result["thread"] = thread
    return result


def test_approve_unblocks_with_true():
    confirmer = BlockingConfirmer(timeout=5)
    result = ask_in_thread(confirmer)
    assert confirmer.pending == ACTION
    confirmer.resolve(True)
    result["thread"].join(2)
    assert result["answer"] is True
    assert confirmer.pending is None


def test_cancel_unblocks_with_false():
    confirmer = BlockingConfirmer(timeout=5)
    result = ask_in_thread(confirmer)
    confirmer.resolve(False)
    result["thread"].join(2)
    assert result["answer"] is False


def test_no_answer_times_out_as_declined():
    confirmer = BlockingConfirmer(timeout=0.05)
    assert confirmer(ACTION) is False
    assert confirmer.pending is None


def test_stale_click_with_nothing_pending_is_ignored():
    confirmer = BlockingConfirmer(timeout=0.05)
    confirmer.resolve(True)  # e.g. a double click after the prompt went away
    assert confirmer(ACTION) is False  # the earlier click doesn't pre-approve


class StubAgent:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    def run(self, text):
        if self.error:
            raise self.error
        return self.result


def test_background_turn_captures_reply():
    turn = BackgroundTurn(StubAgent(result="reply"), "hi")
    assert turn.wait(2) and turn.done
    assert turn.reply == "reply" and turn.error is None


def test_background_turn_captures_error():
    turn = BackgroundTurn(StubAgent(error=RuntimeError("boom")), "hi")
    turn.wait(2)
    assert isinstance(turn.error, RuntimeError)
