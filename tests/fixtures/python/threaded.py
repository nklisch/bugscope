"""Multi-threaded program for thread debugging tests."""
import threading


def worker(name: str, count: int):
    total = 0
    for i in range(count):
        total += i
    print(f"{name}: {total}")


if __name__ == "__main__":
    t1 = threading.Thread(target=worker, args=("worker-1", 5), name="worker-1")
    t2 = threading.Thread(target=worker, args=("worker-2", 5), name="worker-2")
    t1.start()
    t2.start()
    t1.join()
    t2.join()
