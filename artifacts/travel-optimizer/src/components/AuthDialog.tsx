import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const { login, signup } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode() {
    setMode((current) => (current === 'login' ? 'signup' : 'login'));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }

    if (password.length < 8 || password.length > 72) {
      setError('Password must be between 8 and 72 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      const credentials = {
        email: email.trim(),
        password,
      };

      if (mode === 'login') {
        await login(credentials);
      } else {
        await signup(credentials);
      }

      setEmail('');
      setPassword('');
      onOpenChange(false);
    } catch {
      setError(
        mode === 'login'
          ? 'Unable to log in. Check your email and password.'
          : 'Unable to create your account. That email may already be in use.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#203b47]">
            {mode === 'login' ? 'Welcome back' : 'Create your Kalyra account'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'login'
              ? 'Log in to access your saved trips.'
              : 'Create an account to save and revisit your trips.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              maxLength={72}
              disabled={isSubmitting}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full bg-[#203b47] text-[#f5f0e6] hover:bg-[#315565]"
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'login' ? 'Log in' : 'Create account'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="font-semibold text-[#203b47] underline-offset-4 hover:underline"
              disabled={isSubmitting}
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
