export const MediaTypeOptions = {
  All: "All",
  Videos: "Videos",
  Images: "Images",
};

export async function requestMediaLibraryPermissionsAsync() {
  return { status: "granted", granted: true };
}

export async function requestCameraPermissionsAsync() {
  return { status: "granted", granted: true };
}

export async function launchImageLibraryAsync() {
  return {
    canceled: false,
    assets: [
      {
        uri: "file://mock/avatar.jpg",
        width: 300,
        height: 300,
        mimeType: "image/jpeg",
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    ],
  };
}

export async function launchCameraAsync() {
  return {
    canceled: false,
    assets: [
      {
        uri: "file://mock/avatar-camera.jpg",
        width: 300,
        height: 300,
        mimeType: "image/jpeg",
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    ],
  };
}
