"""Target for attach mode tests. Runs with debugpy --listen."""
import time


def process():
    count = 0
    while count < 10:
        count += 1
        time.sleep(0.1)
    return count


if __name__ == "__main__":
    result = process()
    print(f"Done: {result}")
