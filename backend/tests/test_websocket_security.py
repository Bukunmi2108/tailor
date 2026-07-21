from app.websocket.chat import origin_allowed


def test_websocket_origin_must_be_explicitly_allowed():
    allowed = ["https://tailor.example.com", "http://localhost:5173"]

    assert origin_allowed("https://tailor.example.com", allowed)
    assert not origin_allowed("https://attacker.example", allowed)
    assert not origin_allowed(None, allowed)
