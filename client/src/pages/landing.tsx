import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, DollarSign, CheckSquare, Activity } from "lucide-react";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4" data-testid="text-landing-title">TownGrid CRM</h1>
          <p className="text-xl text-muted-foreground mb-8" data-testid="text-landing-subtitle">
            Your personal sales management platform
          </p>
          <Button 
            size="lg" 
            onClick={handleLogin}
            data-testid="button-login"
            className="text-lg px-8 py-6"
          >
            Sign In to Get Started
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          <Card data-testid="card-feature-contacts">
            <CardHeader>
              <Users className="h-10 w-10 mb-2 text-primary" />
              <CardTitle>Contact Management</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Keep track of all your contacts, companies, and relationships in one place.
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-deals">
            <CardHeader>
              <DollarSign className="h-10 w-10 mb-2 text-primary" />
              <CardTitle>Deal Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Manage your sales pipeline from lead to closed deal with clear stage tracking.
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-tasks">
            <CardHeader>
              <CheckSquare className="h-10 w-10 mb-2 text-primary" />
              <CardTitle>Task Management</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Never miss a follow-up with organized task tracking and reminders.
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-analytics">
            <CardHeader>
              <Activity className="h-10 w-10 mb-2 text-primary" />
              <CardTitle>Analytics & Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Get insights into your sales performance with comprehensive dashboards.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-3xl font-bold mb-6">Perfect for Sales Teams</h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Each salesperson gets their own secure portal to manage contacts, track deals, 
            and monitor their pipeline. Everything you create stays private to your account, 
            ensuring data isolation and security.
          </p>
        </div>
      </div>
    </div>
  );
}
