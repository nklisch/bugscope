// Multi-goroutine program for thread debugging tests.
package main

import (
	"fmt"
	"sync"
)

func worker(name string, count int, wg *sync.WaitGroup) {
	defer wg.Done()
	total := 0
	for i := 0; i < count; i++ {
		total += i
	}
	fmt.Printf("%s: %d\n", name, total)
}

func main() {
	var wg sync.WaitGroup
	wg.Add(2)
	go worker("worker-1", 5, &wg)
	go worker("worker-2", 5, &wg)
	wg.Wait()
}
