// Sharing a photo or a file with the assistant: from the camera, the photo library or the phone's files.
// Photos are made smaller first (a phone photo is several MB; the assistant needs far less to read an
// invoice or a business card). Uploaded like the website's 📎, so the assistant can read it.

import { File, UploadType } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

import { authHeaders } from './api';
import { API_URL } from './config';

export interface Attachment { name: string; uri: string; mimeType: string }

/** What the server accepts in one upload. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 1800;

function denied(what: string) {
  Alert.alert(`${what} is off`, `Allow Agentic Factor to use the ${what.toLowerCase()} in Settings to share photos with your assistant.`, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
  ]);
}

async function smaller(asset: ImagePicker.ImagePickerAsset): Promise<Attachment> {
  const wide = (asset.width ?? 0) >= (asset.height ?? 0);
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width ?? 0, asset.height ?? 0) > MAX_SIDE) context.resize(wide ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const base = (asset.fileName ?? 'photo').replace(/\.[^.]+$/, '');
  return { name: `${base}.jpg`, uri: saved.uri, mimeType: 'image/jpeg' };
}

/** Lets the customer pick something to share; null when they changed their mind. */
export async function pickAttachment(from: 'camera' | 'photos' | 'file'): Promise<Attachment | null> {
  if (from === 'camera') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) { denied('Camera'); return null; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    return result.canceled || !result.assets[0] ? null : smaller(result.assets[0]);
  }
  if (from === 'photos') {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    return result.canceled || !result.assets[0] ? null : smaller(result.assets[0]);
  }
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const doc = result.canceled ? null : result.assets[0];
  if (!doc) return null;
  if ((doc.size ?? 0) > MAX_BYTES) {
    Alert.alert('That file is too big', 'Files up to 4 MB can be shared for now.');
    return null;
  }
  return { name: doc.name, uri: doc.uri, mimeType: doc.mimeType ?? 'application/octet-stream' };
}

/** Uploads it; the assistant reads it when the message mentions it. */
export async function uploadAttachment(a: Attachment, missionId?: string): Promise<void> {
  const res = await new File(a.uri).upload(`${API_URL}/api/upload-file`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: a.mimeType,
    headers: await authHeaders(),
    ...(missionId ? { parameters: { missionId } } : {}),
  });
  let data: { success?: boolean; error?: string } = {};
  try { data = JSON.parse(res.body) as typeof data; } catch { /* not JSON */ }
  if (res.status === 413) throw new Error('That file is too big to share.');
  if (res.status < 200 || res.status >= 300 || !data.success) throw new Error(data.error ?? 'Upload failed.');
}
