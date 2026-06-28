"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import axios from "axios";
import { User } from "@/types";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  register: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
const TOKEN_KEY = "stellarmarket_jwt";
const USER_KEY = "stellarmarket_user";

const setCookie = (name: string, value: string, days: number) => {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
};

const removeCookie = (name: string) => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    removeCookie(TOKEN_KEY);
    setToken(null);
    setUser(null);
    router.push("/auth/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    setToken(storedToken);

    try {
      const response = await axios.get(`${API}/users/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const userData = response.data;
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    } catch (error) {
      console.error("Failed to fetch user:", error);
      logout();
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Still refresh to ensure user is valid and data is fresh
        refreshUser();
      } catch {
        logout();
      }
    } else {
      setIsLoading(false);
    }
  }, [logout, refreshUser]);

  const login = useCallback(
    (newToken: string, newUser: User) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setCookie(TOKEN_KEY, newToken, 7);
      setToken(newToken);
      setUser(newUser);
      router.push("/dashboard");
    },
    [router],
  );

  const register = useCallback(
    (newToken: string, newUser: User) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setCookie(TOKEN_KEY, newToken, 7);
      setToken(newToken);
      setUser(newUser);
      router.push("/dashboard");
    },
    [router],
  );

  const updateUser = useCallback((data: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...data };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
      updateUser,
    }),
    [user, token, isLoading, login, register, logout, refreshUser, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
