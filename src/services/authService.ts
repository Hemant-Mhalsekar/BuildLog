import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { SCHEMA_LIMITS, validateDisplayName } from '../utils/validation';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function mapAuthError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Authentication failed. Please try again.';
  }
  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = 'message' in error ? String((error as { message: unknown }).message) : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please check your credentials and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment before trying again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before finishing.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups for this site.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'Email/Password sign-in is not enabled yet in Firebase Console (Authentication -> Sign-in method -> Email/Password). You can enable it there or continue with Google sign-in.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase Authentication. Check your connection.';
    default:
      return message || 'Authentication failed. Please try again.';
  }
}

export async function ensureUserProfile(user: User, preferredDisplayName?: string): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const resolvedName = (
    preferredDisplayName ||
    user.displayName ||
    user.email?.split('@')[0] ||
    'Developer'
  )
    .trim()
    .slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  const resolvedEmail = (user.email || 'user@buildlog.local').trim().slice(0, 254);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName: resolvedName || 'Developer',
        email: resolvedEmail,
        optInCodeDiff: false,
        retentionDays: 365,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function signUpWithEmail(
  displayName: string,
  email: string,
  password: string
): Promise<User> {
  const nameErr = validateDisplayName(displayName);
  if (nameErr) throw new Error(nameErr);

  const trimmedName = displayName.trim().slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: trimmedName });
  await ensureUserProfile(credential.user, trimmedName);
  return credential.user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function loginWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logout(): Promise<void> {
  await signOut(auth);
}

export async function updateUserDisplayName(user: User, displayName: string): Promise<void> {
  const err = validateDisplayName(displayName);
  if (err) throw new Error(err);

  const trimmedName = displayName.trim().slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX);
  await updateProfile(user, { displayName: trimmedName });

  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        displayName: trimmedName,
        email: (user.email || snap.data().email || 'user@buildlog.local').slice(0, 254),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid: user.uid,
        displayName: trimmedName,
        email: (user.email || 'user@buildlog.local').slice(0, 254),
        optInCodeDiff: false,
        retentionDays: 365,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateUserPrivacySettings(
  user: User,
  settings: { optInCodeDiff: boolean; retentionDays: number }
): Promise<void> {
  const retention = Math.min(
    SCHEMA_LIMITS.RETENTION_MAX_DAYS,
    Math.max(SCHEMA_LIMITS.RETENTION_MIN_DAYS, Math.round(settings.retentionDays))
  );
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    await updateDoc(ref, {
      optInCodeDiff: Boolean(settings.optInCodeDiff),
      retentionDays: retention,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
