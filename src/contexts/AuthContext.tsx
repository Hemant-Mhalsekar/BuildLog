import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { subscribeUserProfile } from '../services/dbService';
import { ensureUserProfile } from '../services/authService';
import type { UserProfile } from '../types/models';

interface AuthContextValue {
  user: User | null;
  userProfile: UserProfile | null;
  authReady: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (firebaseUser) {
        void ensureUserProfile(firebaseUser).catch((err) => {
          console.error('Failed to ensure user profile:', err);
        });
        unsubProfile = subscribeUserProfile(
          firebaseUser.uid,
          (profile) => {
            setUserProfile(profile);
          },
          (err) => {
            console.error('Profile listener error:', err);
          }
        );
      } else {
        setUserProfile(null);
      }

      setAuthReady(true);
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, userProfile, authReady }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
