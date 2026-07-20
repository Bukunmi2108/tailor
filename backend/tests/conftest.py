import pytest

from app.canon import load_canon


@pytest.fixture
def resume():
    return load_canon().model_copy(deep=True)
