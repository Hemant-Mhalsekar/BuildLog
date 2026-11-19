import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Ensure persistent login sessions across browser reloads
void setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('Failed to configure auth persistence:', err);
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  throw new Error(serialized);
}

export function parseFriendlyFirestoreError(error: unknown, fallback = 'Something went wrong while saving your data.'): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string') {
      const msg = parsed.error.toLowerCase();
      if (msg.includes('quota exceeded')) {
        return 'Daily Firestore free-tier quota exceeded. Quota resets tomorrow.';
      }
      if (msg.includes('permission') || msg.includes('insufficient')) {
        return 'Permission denied. Please verify you are signed in and own this record.';
      }
      if (msg.includes('offline') || msg.includes('unavailable')) {
        return 'Network unavailable. Check your connection and try again.';
      }
      return parsed.error;
    }
  } catch {
    // Not JSON-encoded FirestoreErrorInfo
  }
  const lower = raw.toLowerCase();
  if (lower.includes('quota exceeded')) {
    return 'Daily Firestore free-tier quota exceeded. Quota resets tomorrow.';
  }
  if (lower.includes('permission')) {
    return 'Permission denied. Please sign in and verify access.';
  }
  return raw || fallback;
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
