//! ParallelProcessor — 从 Python parallel_processing.py 翻译
//! 使用 rayon 实现并行计算

use rayon::prelude::*;

pub struct ParallelProcessor {
    pub num_threads: usize,
}

impl ParallelProcessor {
    pub fn new() -> Self {
        Self { num_threads: num_cpus() }
    }

    pub fn with_threads(num_threads: usize) -> Self {
        Self { num_threads }
    }

    /// 并行处理切片
    pub fn par_map<T, U, F>(&self, data: &[T], f: F) -> Vec<U>
    where
        T: Sync,
        U: Send,
        F: Fn(&T) -> U + Sync + Send,
    {
        data.par_iter().map(&f).collect()
    }

    /// 并行过滤
    pub fn par_filter<T, F>(&self, data: &[T], f: F) -> Vec<T>
    where
        T: Clone + Sync + Send,
        F: Fn(&T) -> bool + Sync + Send,
    {
        data.par_iter().filter(|t| f(*t)).cloned().collect()
    }

    /// 并行 reduce
    pub fn par_reduce<T, U, F, R>(&self, data: &[T], init: U, map: F, reduce: R) -> U
    where
        T: Sync,
        U: Clone + Send + Sync,
        F: Fn(&T) -> U + Sync + Send,
        R: Fn(U, U) -> U + Sync + Send,
    {
        data.par_iter()
            .map(&map)
            .reduce(|| init.clone(), &reduce)
    }
}

impl Default for ParallelProcessor {
    fn default() -> Self { Self::new() }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
