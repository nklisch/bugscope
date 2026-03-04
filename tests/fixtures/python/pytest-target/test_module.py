from module import calculate


def test_calculate():
    result = calculate(2, 3)
    assert result == 5
