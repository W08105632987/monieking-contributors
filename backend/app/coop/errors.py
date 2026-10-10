class CoopError(Exception):
    """A rule was not met. `message` is safe to show to the person."""
    def __init__(self, message: str, status: int = 400, code: str = "coop_error", data: dict | None = None):
        super().__init__(message)
        self.message, self.status, self.code, self.data = message, status, code, data or {}
