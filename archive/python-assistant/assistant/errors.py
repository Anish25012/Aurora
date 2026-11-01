"""Exceptions shared across layers.

ToolError lives here, not in tools/, so the API clients can raise it without
depending on the tool layer. Dependencies only point one way: tools -> clients.
"""


class ToolError(Exception):
    """An expected, user-explainable failure (e.g. "no active Spotify device").

    The message is shown to the model verbatim, so it should say what went wrong
    and, ideally, what the user can do about it.
    """
