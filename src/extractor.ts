export type Point3D = { x: number; y: number; z: number; visibility?: number };

// Helpers de Geometria
function dist3D(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
}

function getCenter(points: Point3D[]): Point3D {
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) {
    cx += p.x; cy += p.y; cz += p.z;
  }
  return { x: cx / points.length, y: cy / points.length, z: cz / points.length };
}

// Retorna [pitch, yaw, roll] de uma matriz de rotação 3x3
function matrixToEuler(R: number[][]): [number, number, number] {
  const sy = Math.sqrt(R[0][0] * R[0][0] +  R[1][0] * R[1][0]);
  const singular = sy < 1e-6;

  let x, y, z;
  if (!singular) {
    x = Math.atan2(R[2][1], R[2][2]);
    y = Math.atan2(-R[2][0], sy);
    z = Math.atan2(R[1][0], R[0][0]);
  } else {
    x = Math.atan2(-R[1][2], R[1][1]);
    y = Math.atan2(-R[2][0], sy);
    z = 0;
  }
  return [x, y, z]; // pitch, yaw, roll
}

export function extractEyeFeatures(
  landmarks: Point3D[],
  matrixData?: Float32Array | number[]
): number[] {
  const f: number[] = [];

  // Indices do MediaPipe Face Mesh
  // Íris Direita (olho esquerdo na imagem espelhada): 468-472
  // Íris Esquerda (olho direito na imagem espelhada): 473-477
  // Olho Direito Contorno: 33 (outer), 159 (top), 133 (inner), 145 (bottom)
  // Olho Esquerdo Contorno: 362 (inner), 386 (top), 263 (outer), 374 (bottom)
  
  const irisLPoints = [landmarks[468], landmarks[469], landmarks[470], landmarks[471], landmarks[472]];
  const irisRPoints = [landmarks[473], landmarks[474], landmarks[475], landmarks[476], landmarks[477]];
  
  const eyeLOuter = landmarks[33], eyeLInner = landmarks[133], eyeLTop = landmarks[159], eyeLBottom = landmarks[145];
  const eyeROuter = landmarks[263], eyeRInner = landmarks[362], eyeRTop = landmarks[386], eyeRBottom = landmarks[374];

  const nose = landmarks[1];
  const faceLeft = landmarks[234];
  const faceRight = landmarks[454];
  const faceTop = landmarks[10];
  const faceBottom = landmarks[152];

  const irisLCenter = getCenter(irisLPoints);
  const irisRCenter = getCenter(irisRPoints);

  // === Grupo 1: Íris (10 features) ===
  f.push(irisLCenter.x, irisLCenter.y);
  f.push(irisRCenter.x, irisRCenter.y);

  const radiusL = (dist3D(irisLCenter, irisLPoints[1]) + dist3D(irisLCenter, irisLPoints[3])) / 2;
  const radiusR = (dist3D(irisRCenter, irisRPoints[1]) + dist3D(irisRCenter, irisRPoints[3])) / 2;
  f.push(radiusL, radiusR);

  const areaIrisL = Math.PI * radiusL * radiusL;
  const areaIrisR = Math.PI * radiusR * radiusR;
  f.push(areaIrisL, areaIrisR);

  const circL = dist3D(irisLPoints[1], irisLPoints[3]) / (dist3D(irisLPoints[2], irisLPoints[4]) + 1e-6);
  const circR = dist3D(irisRPoints[1], irisRPoints[3]) / (dist3D(irisRPoints[2], irisRPoints[4]) + 1e-6);
  f.push(circL, circR);

  // === Grupo 2: Geometria dos Olhos (10 features) ===
  const widthL = dist3D(eyeLOuter, eyeLInner);
  const widthR = dist3D(eyeROuter, eyeRInner);
  f.push(widthL, widthR);

  const heightL = dist3D(eyeLTop, eyeLBottom);
  const heightR = dist3D(eyeRTop, eyeRBottom);
  f.push(heightL, heightR);

  const areaEyeL = Math.PI * (widthL / 2) * (heightL / 2);
  const areaEyeR = Math.PI * (widthR / 2) * (heightR / 2);
  f.push(areaEyeL, areaEyeR);

  const earL = heightL / (widthL + 1e-6);
  const earR = heightR / (widthR + 1e-6);
  f.push(earL, earR);

  const rotL = Math.atan2(eyeLOuter.y - eyeLInner.y, eyeLOuter.x - eyeLInner.x);
  const rotR = Math.atan2(eyeROuter.y - eyeRInner.y, eyeROuter.x - eyeRInner.x);
  f.push(rotL, rotR);

  // === Grupo 3: Relações Íris × Olho (12 features) ===
  const hRatioL = dist3D(irisLCenter, eyeLInner) / (widthL + 1e-6);
  const hRatioR = dist3D(irisRCenter, eyeRInner) / (widthR + 1e-6);
  f.push(hRatioL, hRatioR);

  const vRatioL = dist3D(irisLCenter, eyeLTop) / (heightL + 1e-6);
  const vRatioR = dist3D(irisRCenter, eyeRTop) / (heightR + 1e-6);
  f.push(vRatioL, vRatioR);

  f.push(dist3D(irisLCenter, eyeLTop), dist3D(irisRCenter, eyeRTop));
  f.push(dist3D(irisLCenter, eyeLBottom), dist3D(irisRCenter, eyeRBottom));
  f.push(dist3D(irisLCenter, eyeLInner), dist3D(irisRCenter, eyeRInner));
  f.push(dist3D(irisLCenter, eyeLOuter), dist3D(irisRCenter, eyeROuter));

  // === Grupo 4: Head Pose (6 features) ===
  let pitch = 0, yaw = 0, roll = 0;
  let tx = 0, ty = 0, tz = 0;

  if (matrixData && matrixData.length === 16) {
    const R = [
      [matrixData[0], matrixData[4], matrixData[8]],
      [matrixData[1], matrixData[5], matrixData[9]],
      [matrixData[2], matrixData[6], matrixData[10]]
    ];
    [pitch, yaw, roll] = matrixToEuler(R);
    tx = matrixData[12];
    ty = matrixData[13];
    tz = matrixData[14];
  }
  f.push(yaw, pitch, roll, tx, ty, tz);

  // === Grupo 5: Geometria da Face (5 features) ===
  const iod = dist3D(eyeLInner, eyeRInner);
  f.push(iod);

  const eyeLCenter = getCenter([eyeLOuter, eyeLInner, eyeLTop, eyeLBottom]);
  const eyeRCenter = getCenter([eyeROuter, eyeRInner, eyeRTop, eyeRBottom]);
  const noseDist = (dist3D(nose, eyeLCenter) + dist3D(nose, eyeRCenter)) / 2;
  f.push(noseDist);

  const faceW = dist3D(faceLeft, faceRight);
  const faceH = dist3D(faceTop, faceBottom);
  f.push(faceW, faceH);

  const cameraDistEst = 1.0 / (faceW + 1e-6);
  f.push(cameraDistEst);

  // === Grupo 6: Simetria (5 features) ===
  f.push(earL / (earR + 1e-6));
  f.push(heightL / (heightR + 1e-6));
  f.push(radiusL / (radiusR + 1e-6));
  f.push(widthL / (widthR + 1e-6));
  f.push(areaEyeL / (areaEyeR + 1e-6));

  // === Grupo 7: Qualidade (5 features) ===
  const faceVis = landmarks[1].visibility ?? 1.0;
  f.push(faceVis);

  const eyeVisL = eyeLOuter.visibility ?? 1.0;
  const eyeVisR = eyeROuter.visibility ?? 1.0;
  f.push(eyeVisL, eyeVisR);

  const irisVisL = irisLCenter.visibility ?? 1.0;
  const irisVisR = irisRCenter.visibility ?? 1.0;
  f.push(irisVisL, irisVisR);

  return f;
}
