use crate::model::{ExecutionConfig, ExecutionProvider};
use crate::types::{CanaryError, Result};
use ort::ep::ExecutionProviderDispatch;
use ort::session::builder::SessionBuilder;

pub fn apply_execution_providers(
    mut builder: SessionBuilder,
    config: &ExecutionConfig,
) -> Result<SessionBuilder> {
    let providers = execution_providers(config)?;
    builder = builder.with_execution_providers(providers)?;
    Ok(builder)
}

fn execution_providers(config: &ExecutionConfig) -> Result<Vec<ExecutionProviderDispatch>> {
    let mut providers = Vec::new();

    match config.execution_provider {
        ExecutionProvider::Cpu => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::Cuda => {
            providers.push(cuda_provider(config.cuda_device_id)?);
            providers.push(cpu_provider());
        }
        ExecutionProvider::TensorRT => {
            providers.push(tensorrt_provider(config.cuda_device_id)?);
            providers.push(cpu_provider());
        }
        ExecutionProvider::CoreML => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::DirectML => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::ROCm => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::OpenVINO => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::WebGPU => {
            providers.push(cpu_provider());
        }
        ExecutionProvider::NNAPI => {
            providers.push(cpu_provider());
        }
    }

    Ok(providers)
}

fn cpu_provider() -> ExecutionProviderDispatch {
    ort::ep::CPU::default().build()
}

fn cuda_provider(_device_id: i32) -> Result<ExecutionProviderDispatch> {
    Err(CanaryError::ModelError(
        "CUDA execution provider not enabled".into(),
    ))
}

fn tensorrt_provider(_device_id: i32) -> Result<ExecutionProviderDispatch> {
    Err(CanaryError::ModelError(
        "TensorRT execution provider not enabled".into(),
    ))
}

