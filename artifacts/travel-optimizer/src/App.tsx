import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { TripProvider } from '@/context/TripContext';
import { AuthProvider } from '@/context/AuthContext';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/landing';
import Plan from '@/pages/plan';
import Analysis from '@/pages/analysis';
import Trip from '@/pages/trip';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <TripProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/plan" component={Plan} />
              <Route path="/analysis" component={Analysis} />
              <Route path="/trip" component={Trip} />
              <Route component={NotFound} />
            </Switch>
          </WouterRouter>
            <Toaster />
          </TripProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
