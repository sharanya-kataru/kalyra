import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import {
  useGetMe,
  useLogIn,
  useLogOut,
  useSignUp,
} from '@workspace/api-client-react';
import type { AuthCredentials, AuthUser } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: AuthCredentials) => Promise<AuthUser>;
  signup: (credentials: AuthCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useGetMe({
    query: {
      queryKey: ['/api/auth/me'],
      retry: false,
    },
  });

  const loginMutation = useLogIn();
  const signupMutation = useSignUp();
  const logoutMutation = useLogOut();

  async function login(credentials: AuthCredentials) {
    const user = await loginMutation.mutateAsync({ data: credentials });
    await queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    return user;
  }

  async function signup(credentials: AuthCredentials) {
    const user = await signupMutation.mutateAsync({ data: credentials });
    await queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    return user;
  }

  async function logout() {
    await logoutMutation.mutateAsync();
    queryClient.clear();
  }

  const user = meQuery.data ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: meQuery.isLoading,
        isAuthenticated: user !== null,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
