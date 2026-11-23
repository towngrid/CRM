import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Target,
  Calendar,
  PieChart,
  Activity,
  Trophy,
  Award,
  CheckCircle2
} from "lucide-react";
import type { Deal, Contact, Task, Activity as ActivityType, User } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateCommission } from "@shared/utils";
import { stageDotClass, stageLabel } from "@shared/dealStages";

type SalespersonRanking = {
  userId: string;
  name: string;
  dealsWon: number;
  totalValue: number;
  totalDeals: number;
  winRate: number;
  avgDealValue: number;
};

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  
  // Admin-specific query for salesperson rankings
  const { data: rankings, isLoading: rankingsLoading } = useQuery<SalespersonRanking[]>({
    queryKey: ["/api/admin/salesperson-rankings"],
    enabled: isAdmin, // Only fetch if user is admin
  });

  // Admin: Fetch all deals for approval
  const { data: adminDeals, isLoading: adminDealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    enabled: isAdmin,
  });

  // Mutation to approve/reject deals
  const approveDealMutation = useMutation({
    mutationFn: async ({ dealId, approved }: { dealId: string; approved: string }) => {
      return apiRequest("PATCH", `/api/deals/${dealId}/approve`, { approved });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Success",
        description: "Deal approval status updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update deal approval",
        variant: "destructive",
      });
    },
  });

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    enabled: !isAdmin, // Only fetch for salespeople
  });

  const { data: contacts, isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    enabled: !isAdmin, // Only fetch for salespeople
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    enabled: !isAdmin, // Only fetch for salespeople
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<ActivityType[]>({
    queryKey: ["/api/activities"],
    queryFn: async () => {
      const response = await fetch("/api/activities?limit=100");
      return response.json();
    },
    enabled: !isAdmin, // Only fetch for salespeople
  });

  const isLoading = isAdmin 
    ? rankingsLoading 
    : (dealsLoading || contactsLoading || tasksLoading || activitiesLoading);

  // Calculate metrics
  const calculateMetrics = () => {
    if (!deals || !contacts || !tasks) return null;

    const totalRevenue = deals
      .filter(deal => deal.stage === "won")
      .reduce((sum, deal) => sum + parseFloat(deal.value || "0"), 0);

    const totalPipeline = deals
      .filter(deal => !["won", "lost"].includes(deal.stage))
      .reduce((sum, deal) => sum + parseFloat(deal.value || "0"), 0);

    const conversionRate = deals.length > 0 
      ? (deals.filter(deal => deal.stage === "won").length / deals.length) * 100 
      : 0;

    const completedTasks = tasks.filter(task => task.status === "completed").length;
    const taskCompletionRate = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;

    const activeContacts = contacts.filter(contact => contact.status === "active").length;

    // Deal stage distribution
    const stageDistribution = deals.reduce((acc, deal) => {
      acc[deal.stage] = (acc[deal.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Monthly activity (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentActivities = activities?.filter(activity => 
      activity.createdAt && new Date(activity.createdAt) >= sixMonthsAgo
    ) || [];

    const monthlyActivity = recentActivities.reduce((acc, activity) => {
      if (activity.createdAt) {
        const month = new Date(activity.createdAt).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short' 
        });
        acc[month] = (acc[month] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRevenue,
      totalPipeline,
      conversionRate,
      taskCompletionRate,
      activeContacts,
      stageDistribution,
      monthlyActivity,
    };
  };

  const metrics = calculateMetrics();

  const getStageLabel = (stage: string) => {
    return stageLabel(stage);
  };

  const getStageColor = (stage: string) => {
    return stageDotClass(stage);
  };

  if (isLoading) {
    return (
      <>
        <Header title="Reports" showAddButton={false} />
        <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-8 bg-muted rounded w-16"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </>
    );
  }

  // Helper function to format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Admin view: Salesperson rankings
  if (isAdmin) {
    if (!rankings || rankings.length === 0) {
      return (
        <>
          <Header title="Salesperson Rankings" showAddButton={false} />
          <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30">
            <Card>
              <CardContent className="p-12 text-center">
                <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No salespeople data available</h3>
                <p className="text-muted-foreground">
                  Rankings will appear when salespeople start closing deals.
                </p>
              </CardContent>
            </Card>
          </main>
        </>
      );
    }

    return (
      <>
        <Header title="Salesperson Rankings" showAddButton={false} />
        <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30" data-testid="admin-rankings-content">
          {/* Rankings Table */}
          <Card className="mb-8" data-testid="rankings-table">
            <CardHeader>
              <CardTitle className="text-xl font-semibold flex items-center space-x-2">
                <Trophy className="h-6 w-6 text-yellow-500" />
                <span>Top Performers</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                Ranked by number of deals closed
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Salesperson</TableHead>
                    <TableHead className="text-right">Deals Won</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Avg Deal Value</TableHead>
                    <TableHead className="text-right">Total Deals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankings.map((ranking, index) => (
                    <TableRow key={ranking.userId} data-testid={`ranking-row-${index}`}>
                      <TableCell className="font-semibold">
                        {index === 0 && <Trophy className="h-5 w-5 inline text-yellow-500 mr-2" />}
                        {index === 1 && <Award className="h-5 w-5 inline text-gray-400 mr-2" />}
                        {index === 2 && <Award className="h-5 w-5 inline text-orange-600 mr-2" />}
                        {index > 2 && <span className="ml-7">{index + 1}</span>}
                        {index <= 2 && <span>{index + 1}</span>}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`salesperson-name-${index}`}>
                        {ranking.name}
                      </TableCell>
                      <TableCell className="text-right font-semibold" data-testid={`deals-won-${index}`}>
                        {ranking.dealsWon}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`total-value-${index}`}>
                        {formatCurrency(ranking.totalValue)}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`win-rate-${index}`}>
                        {ranking.winRate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right" data-testid={`avg-value-${index}`}>
                        {formatCurrency(ranking.avgDealValue)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`total-deals-${index}`}>
                        {ranking.totalDeals}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Closed Deals Approval */}
          {adminDeals && adminDeals.filter(d => d.stage === "won").length > 0 && (
            <Card className="mb-8" data-testid="deals-approval-table">
              <CardHeader>
                <CardTitle className="text-xl font-semibold flex items-center space-x-2">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                  <span>Commission Approval</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Approve closed deals to release commission payments
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal Title</TableHead>
                      <TableHead>Salesperson</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Approve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminDeals
                      .filter(deal => deal.stage === "won")
                      .map((deal) => {
                        const commission = calculateCommission(deal.plan);
                        return (
                          <TableRow key={deal.id} data-testid={`approval-row-${deal.id}`}>
                            <TableCell className="font-medium">{deal.title}</TableCell>
                            <TableCell>{deal.userId}</TableCell>
                            <TableCell>{deal.plan || "N/A"}</TableCell>
                            <TableCell className="text-right font-semibold">
                              ${commission}
                            </TableCell>
                            <TableCell className="text-center">
                              <span 
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  deal.approved === "approved" 
                                    ? "bg-green-500/10 text-green-600" 
                                    : deal.approved === "rejected"
                                    ? "bg-red-500/10 text-red-600"
                                    : "bg-yellow-500/10 text-yellow-600"
                                }`}
                              >
                                {deal.approved || "pending"}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={deal.approved === "approved"}
                                onCheckedChange={(checked) => {
                                  approveDealMutation.mutate({
                                    dealId: deal.id,
                                    approved: checked ? "approved" : "pending",
                                  });
                                }}
                                data-testid={`checkbox-approve-${deal.id}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Top Performer</p>
                    <p className="text-2xl font-bold text-foreground">
                      {rankings[0]?.name || 'N/A'}
                    </p>
                  </div>
                  <div className="p-3 bg-yellow-500/10 rounded-full">
                    <Trophy className="h-6 w-6 text-yellow-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-muted-foreground">{rankings[0]?.dealsWon || 0} deals closed</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(rankings.reduce((sum, r) => sum + r.totalValue, 0))}
                    </p>
                  </div>
                  <div className="p-3 bg-green-500/10 rounded-full">
                    <DollarSign className="h-6 w-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-muted-foreground">All salespeople combined</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average Win Rate</p>
                    <p className="text-2xl font-bold text-foreground">
                      {rankings.length > 0 
                        ? (rankings.reduce((sum, r) => sum + r.winRate, 0) / rankings.length).toFixed(1)
                        : 0}%
                    </p>
                  </div>
                  <div className="p-3 bg-primary/10 rounded-full">
                    <TrendingUp className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-muted-foreground">Across all salespeople</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </>
    );
  }

  // Salesperson view: Personal metrics
  if (!metrics) {
    return (
      <>
        <Header title="Reports" showAddButton={false} />
        <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30">
          <Card>
            <CardContent className="p-12 text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">No data available</h3>
              <p className="text-muted-foreground">
                Start adding contacts and deals to see your reports.
              </p>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Reports" showAddButton={false} />
      
      <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30" data-testid="reports-content">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card data-testid="revenue-metric">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                  <p className="text-3xl font-bold text-foreground">
                    {formatCurrency(metrics.totalRevenue)}
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Closed won deals</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="pipeline-metric">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Pipeline Value</p>
                  <p className="text-3xl font-bold text-foreground">
                    {formatCurrency(metrics.totalPipeline)}
                  </p>
                </div>
                <div className="p-3 bg-primary/10 rounded-full">
                  <Target className="h-6 w-6 text-primary" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Active deals</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="conversion-metric">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Conversion Rate</p>
                  <p className="text-3xl font-bold text-foreground">
                    {metrics.conversionRate.toFixed(1)}%
                  </p>
                </div>
                <div className="p-3 bg-accent/10 rounded-full">
                  <TrendingUp className="h-6 w-6 text-accent" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Deals to revenue</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="task-completion-metric">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Task Completion</p>
                  <p className="text-3xl font-bold text-foreground">
                    {metrics.taskCompletionRate.toFixed(1)}%
                  </p>
                </div>
                <div className="p-3 bg-yellow-500/10 rounded-full">
                  <Target className="h-6 w-6 text-yellow-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Tasks completed</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Deal Stage Distribution */}
          <Card data-testid="stage-distribution-chart">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                <PieChart className="h-5 w-5" />
                <span>Deal Stage Distribution</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(metrics.stageDistribution).map(([stage, count]) => {
                  const percentage = deals ? (count / deals.length) * 100 : 0;
                  return (
                    <div key={stage} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 ${getStageColor(stage)} rounded-full`}></div>
                        <span className="font-medium text-foreground">
                          {getStageLabel(stage)}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{count} deals</p>
                        <p className="text-sm text-muted-foreground">
                          {percentage.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Monthly Activity Trend */}
          <Card data-testid="monthly-activity-chart">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                <Activity className="h-5 w-5" />
                <span>Monthly Activity Trend</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(metrics.monthlyActivity)
                  .sort(([a], [b]) => new Date(a + " 1").getTime() - new Date(b + " 1").getTime())
                  .slice(-6) // Last 6 months
                  .map(([month, count]) => {
                    const maxCount = Math.max(...Object.values(metrics.monthlyActivity));
                    const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
                    return (
                      <div key={month} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-foreground">{month}</span>
                          <span className="text-sm text-muted-foreground">{count} activities</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div 
                            className="bg-primary h-2 rounded-full transition-all duration-300"
                            style={{ width: `${width}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary Statistics */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card data-testid="contacts-summary">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>Contacts Summary</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Contacts</span>
                  <span className="font-semibold text-foreground">{contacts?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Active Contacts</span>
                  <span className="font-semibold text-foreground">{metrics.activeContacts}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Companies</span>
                  <span className="font-semibold text-foreground">
                    {new Set(contacts?.map(c => c.company).filter(Boolean)).size}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="deals-summary">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                <Target className="h-5 w-5" />
                <span>Deals Summary</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Deals</span>
                  <span className="font-semibold text-foreground">{deals?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Won Deals</span>
                  <span className="font-semibold text-foreground">
                    {deals?.filter(d => d.stage === "closed_won").length || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Lost Deals</span>
                  <span className="font-semibold text-foreground">
                    {deals?.filter(d => d.stage === "closed_lost").length || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="tasks-summary">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center space-x-2">
                <Calendar className="h-5 w-5" />
                <span>Tasks Summary</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Tasks</span>
                  <span className="font-semibold text-foreground">{tasks?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-semibold text-foreground">
                    {tasks?.filter(t => t.status === "completed").length || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-semibold text-foreground">
                    {tasks?.filter(t => t.status === "pending").length || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
