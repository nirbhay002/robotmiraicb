import * as faceapi from "face-api.js";

const DB_NAME = "RomajiFaceDB";
const STORE_NAME = "users";
const DB_VERSION = 2;

const MATCH_THRESHOLD = 0.6;
const MIN_FACE_SIZE = 80;
const MIN_DETECTION_CONFIDENCE = 0.4;

type StoredUser = {
  name: string;
  descriptors?: number[][];
  descriptor?: number[];
  createdAt?: number;
  updatedAt?: number;
};

type FaceDetectionResult = {
  face: faceapi.WithFaceDescriptor<
    faceapi.WithFaceLandmarks<faceapi.WithFaceDetection<{}>>
  >;
  quality: "good" | "ok" | "poor";
};

/* ================= DB INIT ================= */
const initDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/* ================= LOAD MODELS ================= */
export const loadFaceModels = async () => {
  try {
    const MODEL_URL = "/models";
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    console.log("✅ Face models loaded");
    return true;
  } catch (err) {
    console.error("❌ Error loading face models:", err);
    throw err;
  }
};

/* ================= FACE QUALITY CHECK ================= */
const assessFaceQuality = (
  detection: faceapi.FaceDetection
): "good" | "ok" | "poor" => {
  const box = detection.box;
  const area = box.width * box.height;

  if (area < MIN_FACE_SIZE * MIN_FACE_SIZE) return "poor";

  const confidence = detection.score;
  if (confidence > 0.7) return "good";
  if (confidence > 0.5) return "ok";
  return "poor";
};

/* ================= FACE DETECTION ================= */
export const getClosestFace = async (
  video: HTMLVideoElement
): Promise<FaceDetectionResult | null> => {
  try {
    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: MIN_DETECTION_CONFIDENCE,
    });

    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!detections.length) return null;

    const closest = detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b
    );

    const quality = assessFaceQuality(closest.detection);

    return {
      face: closest,
      quality,
    };
  } catch (err) {
    console.error("Error in getClosestFace:", err);
    return null;
  }
};

/* ================= DESCRIPTOR AVERAGE ================= */
const averageDescriptor = (list?: number[][]): Float32Array | null => {
  if (!Array.isArray(list) || list.length === 0) return null;

  const avg = new Array(128).fill(0);
  let validCount = 0;

  list.forEach((d) => {
    if (!Array.isArray(d) || d.length !== 128) return;
    validCount++;
    for (let i = 0; i < 128; i++) {
      avg[i] += d[i];
    }
  });

  if (validCount === 0) return null;

  for (let i = 0; i < 128; i++) {
    avg[i] /= validCount;
  }

  return new Float32Array(avg);
};

/* ================= IDENTIFY FACE ================= */
export const identifyFace = async (
  descriptor: Float32Array
): Promise<{ name: string; confidence: number } | null> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const req = store.getAll();

      req.onsuccess = () => {
        const users: StoredUser[] = req.result;

        if (!users.length) {
          resolve(null);
          return;
        }

        const labeled: faceapi.LabeledFaceDescriptors[] = [];

        users.forEach((u) => {
          let descriptors = u.descriptors;

          if (!descriptors && Array.isArray(u.descriptor)) {
            descriptors = [u.descriptor];
          }

          const avg = averageDescriptor(descriptors);
          if (!avg) return;

          labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [avg]));
        });

        if (!labeled.length) {
          resolve(null);
          return;
        }

        const matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
        const match = matcher.findBestMatch(descriptor);

        console.log(
          `🔎 Match: "${match.label}" | Distance: ${match.distance.toFixed(4)} | Threshold: ${MATCH_THRESHOLD}`
        );

        if (match.label !== "unknown" && match.distance < MATCH_THRESHOLD) {
          const confidence = Math.max(0, 1 - match.distance);
          resolve({ name: match.label, confidence });
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        console.error("Error reading from DB");
        resolve(null);
      };
    });
  } catch (err) {
    console.error("Error in identifyFace:", err);
    return null;
  }
};

/* ================= SAVE USER ================= */
export const saveUserData = async (
  name: string,
  descriptor: Float32Array
): Promise<boolean> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const desc = Array.from(descriptor);

    return new Promise<boolean>((resolve) => {
      const getReq = store.get(name);

      getReq.onsuccess = () => {
        const existing: StoredUser | undefined = getReq.result;

        if (existing) {
          const list = existing.descriptors ?? [];
          list.push(desc);
          existing.descriptors = list.slice(-5);
          existing.updatedAt = Date.now();
          delete existing.descriptor;

          const putReq = store.put(existing);
          putReq.onsuccess = () => {
            console.log(`🔁 Updated user: "${name}" (${existing.descriptors?.length} samples)`);
            resolve(true);
          };
          putReq.onerror = () => resolve(false);
        } else {
          const newUser: StoredUser = {
            name,
            descriptors: [desc],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const putReq = store.put(newUser);
          putReq.onsuccess = () => {
            console.log(`✅ New user saved: "${name}"`);
            resolve(true);
          };
          putReq.onerror = () => resolve(false);
        }
      };

      getReq.onerror = () => {
        console.error("Error checking existing user");
        resolve(false);
      };
    });
  } catch (err) {
    console.error("Error in saveUserData:", err);
    return false;
  }
};

/* ================= GET ALL USERS ================= */
export const getAllRegisteredNames = async (): Promise<string[]> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise<string[]>((resolve) => {
      const req = store.getAll();

      req.onsuccess = () => {
        const users: StoredUser[] = req.result;
        resolve(users.map((u) => u.name));
      };

      req.onerror = () => {
        console.error("Error fetching registered names");
        resolve([]);
      };
    });
  } catch (err) {
    console.error("Error in getAllRegisteredNames:", err);
    return [];
  }
};

/* ================= DELETE USER ================= */
export const deleteUser = async (name: string): Promise<boolean> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise<boolean>((resolve) => {
      const req = store.delete(name);

      req.onsuccess = () => {
        console.log(`🗑️ Deleted user: "${name}"`);
        resolve(true);
      };

      req.onerror = () => {
        console.error(`Error deleting user: "${name}"`);
        resolve(false);
      };
    });
  } catch (err) {
    console.error("Error in deleteUser:", err);
    return false;
  }
};