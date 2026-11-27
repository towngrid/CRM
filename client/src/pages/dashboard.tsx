import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import MetricsGrid from "@/components/dashboard/metrics-grid";
import DealPipeline from "@/components/deals/deal-pipeline";
import RecentActivity from "@/components/dashboard/recent-activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckSquare, Users, Calendar, Upload, ShieldCheck } from "lucide-react";
import type { Task, Contact } from "@shared/schema";
import { useLocation } from "wouter";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: upcomingTasks, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: async () => {
      const response = await fetch("/api/tasks?upcoming=true");
      return response.json();
    },
  });

  const { data: recentContacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const response = await fetch("/api/contacts");
      const contacts = await response.json();
      return contacts.slice(0, 3); // Get 3 most recent
    },
  });

  const formatPriority = (priority: string) => {
    const colors = {
      high: "border-destructive bg-destructive/5 text-destructive",
      medium: "border-yellow-500 bg-yellow-500/5 text-yellow-600",
      low: "border-accent bg-accent/5 text-accent"
    };
    return colors[priority as keyof typeof colors] || colors.medium;
  };

  const formatDueDate = (dueDate: string | Date | null) => {
    if (!dueDate) return "No due date";
    const date = new Date(dueDate);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return date.toLocaleDateString();
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const getTimeAgo = (date: string | Date | null) => {
    if (!date) return "Never";
    const now = new Date();
    const past = new Date(date);
    const diffInHours = Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  };

  return (
    <>
      <Header title="Dashboard" showAddButton={false} />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="dashboard-content">
        <MetricsGrid />

        <Card className="mt-6 border-primary/30 bg-primary/[0.03]" data-testid="business-search-entry">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold">Find businesses</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a type of business and Long Island towns or zip codes. The CRM checks each one's website, social and ordering, scores the opportunity, and shows the cost before it runs.
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Contacts are not added to email sequences automatically.
                </p>
              </div>
            </div>
            <Button className="shrink-0" onClick={() => setLocation("/search")}>
              <Upload className="mr-2 h-4 w-4" />
              Business Search
            </Button>
          </CardContent>
        </Card>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
          <DealPipeline />
          <RecentActivity />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upcoming Tasks */}
          <Card data-testid="upcoming-tasks-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold">Upcoming Tasks</CardTitle>
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
                View All
              </Button>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-muted rounded-lg"></div>
                    </div>
                  ))}
                </div>
              ) : !upcomingTasks?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No upcoming tasks</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-center space-x-3 p-3 border-l-4 rounded-r-lg ${formatPriority(task.priority)}`}
                      data-testid={`task-${task.id}`}
                    >
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-primary rounded border-border focus:ring-primary"
                        data-testid={`task-checkbox-${task.id}`}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {task.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Due: {formatDueDate(task.dueDate)}
                        </p>
                      </div>
                      <span 
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          task.priority === 'high' ? 'bg-destructive text-destructive-foreground' :
                          task.priority === 'medium' ? 'bg-yellow-500 text-white' :
                          'bg-accent text-accent-foreground'
                        }`}
                      >
                        {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Contacts */}
          <Card data-testid="recent-contacts-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold">Recent Contacts</CardTitle>
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
                View All
              </Button>
            </CardHeader>
            <CardContent>
              {contactsLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse flex items-center space-x-3">
                      <div className="w-10 h-10 bg-muted rounded-full"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-24"></div>
                        <div className="h-3 bg-muted rounded w-32"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !recentContacts?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No contacts found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentContacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center space-x-3 p-3 hover:bg-muted/30 rounded-lg transition-colors cursor-pointer"
                      data-testid={`contact-${contact.id}`}
                    >
                      <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-medium">
                        {getInitials(contact.firstName || "", contact.lastName || "")}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {contact.firstName} {contact.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {contact.company || "No company"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {getTimeAgo(contact.lastContactDate)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
