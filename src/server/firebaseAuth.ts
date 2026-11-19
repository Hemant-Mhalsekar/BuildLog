import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function loadProjectId(): string {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (parsed.projectId) return parsed.projectId;
  } catch {
    // Fallback to environment variables
  }
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    ''
  );
}

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        projectId: loadProjectId() || undefined,
      });

export interface AuthenticatedRequest extends Request {
  uid?: string;
  userEmail?: string;
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Missing Bearer Firebase ID token.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is empty.' });
    return;
  }

  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    res.status(401).json({
      error: 'Invalid or expired Firebase authentication token.',
    });
  }
}
