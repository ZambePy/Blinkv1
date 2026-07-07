"""Gera um .onnx dummy (uma camada Dense) só para validar o pipeline de
inferencia Electron + onnxruntime-node. NAO e o encoder CNN real."""
import torch
import torch.nn as nn


class DummyEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(64 * 64, 128)

    def forward(self, x):
        x = x.view(x.shape[0], -1)
        return self.fc(x)


model = DummyEncoder()
model.eval()

dummy_input = torch.zeros(1, 1, 64, 64, dtype=torch.float32)

torch.onnx.export(
    model,
    (dummy_input,),
    "resources/models/gaze_encoder.onnx",
    input_names=["input"],
    output_names=["embedding"],
    opset_version=17,
)

print("OK: resources/models/gaze_encoder.onnx gerado")
