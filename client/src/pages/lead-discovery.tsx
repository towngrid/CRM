import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Search, Plus, Download, Upload, Trash2, Eye, AlertCircle, CheckCircle, Clock, XCircle, RefreshCw, Settings, Pencil, List, Globe } from "lucide-react";
import type { LeadDiscoveryJob, LeadDiscoveryResult, NationalSearchJob } from "@shared/schema";
import { DirectoryEligibilityReview, EligibilitySummaryStrip } from "@/components/directory-eligibility";
import { directoryEligibility, directoryEligibilitySummary, type EligibilityRow } from "@shared/directoryEligibility";

type NationalResultRow = LeadDiscoveryResult & { state: string };

interface LeadDiscoveryConfig {
  serpApiConfigured: boolean;
  usage: {
    used: number;
    quota: number;
    hardStopAt: number;
    warningLevel: 'none' | 'yellow' | 'red' | 'hardstop';
    isQuotaReached: boolean;
  };
  config: {
    queriesPerZip: number;
    maxZipsPerRun: number;
    maxRunsPerDay: number;
    maxSerpCallsPerHour: number;
    enableThirdQuery: boolean;
    planType: string;
  };
  activeQueries: string[];
}

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }
];

export default function LeadDiscovery() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = user?.role === "admin";
  const [showNewJobDialog, setShowNewJobDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<LeadDiscoveryJob | null>(null);
  const [activeTab, setActiveTab] = useState("jobs");
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [viewDetailsResult, setViewDetailsResult] = useState<LeadDiscoveryResult | null>(null);
  
  const [newJobState, setNewJobState] = useState("");
  const [newJobZipCodes, setNewJobZipCodes] = useState("");

  const { data: config, refetch: refetchConfig } = useQuery<LeadDiscoveryConfig>({
    queryKey: ["/api/lead-discovery/config"],
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<LeadDiscoveryConfig['config']>) => {
      const res = await apiRequest("PATCH", "/api/lead-discovery/config", updates);
      return res.json();
    },
    onSuccess: () => {
      refetchConfig();
      toast({ title: "Settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update settings", variant: "destructive" });
    },
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery<LeadDiscoveryJob[]>({
    queryKey: ["/api/lead-discovery/jobs"],
    refetchInterval: selectedJob?.status === "running" ? 3000 : false,
  });

  const { data: results = [], isLoading: resultsLoading } = useQuery<LeadDiscoveryResult[]>({
    queryKey: ["/api/lead-discovery/jobs", selectedJob?.id, "results"],
    enabled: !!selectedJob,
  });

  const { data: allResults = [], isLoading: allResultsLoading } = useQuery<LeadDiscoveryResult[]>({
    queryKey: ["/api/lead-discovery/all-results"],
    enabled: activeTab === "all-results",
  });

  // ── National Search state ──────────────────────────────────────────────────
  const [nationalStateFilter, setNationalStateFilter] = useState<string>("all");

  // Targeted search form state
  const [showTargetedPanel, setShowTargetedPanel] = useState(false);
  const [targetedStates, setTargetedStates] = useState<string[]>([]);
  const [targetedMaxPerState, setTargetedMaxPerState] = useState<number>(2);
  const [targetedNoSoftwareOnly, setTargetedNoSoftwareOnly] = useState(true);

  const { data: nationalJobs = [], refetch: refetchNationalJobs } = useQuery<NationalSearchJob[]>({
    queryKey: ["/api/lead-discovery/national-jobs"],
    refetchInterval: activeTab === "national" ? 4000 : false,
  });

  const activeNationalJob = nationalJobs.find(j => j.status === "running" || j.status === "pending");
  const latestNationalJob = nationalJobs[0] ?? null;

  const { data: nationalResults = [], isLoading: nationalResultsLoading } = useQuery<NationalResultRow[]>({
    queryKey: ["/api/lead-discovery/national-job", latestNationalJob?.id, "results"],
    queryFn: async () => {
      if (!latestNationalJob) return [];
      const res = await apiRequest("GET", `/api/lead-discovery/national-job/${latestNationalJob.id}/results`);
      return res.json();
    },
    enabled: !!latestNationalJob && activeTab === "national",
    refetchInterval: activeNationalJob ? 6000 : false,
  });

  const eligibilityFor = (result: LeadDiscoveryResult) => directoryEligibility(result as unknown as EligibilityRow);
  const safeResults = results.filter(result => !eligibilityFor(result).blocked && result.isImported !== "true");
  const resultEligibilitySummary = directoryEligibilitySummary(results as unknown as EligibilityRow[]);
  const allEligibilitySummary = directoryEligibilitySummary(allResults as unknown as EligibilityRow[]);
  const nationalEligibilitySummary = directoryEligibilitySummary(nationalResults as unknown as EligibilityRow[]);

  const startNationalJobMutation = useMutation({
    mutationFn: async () => {
      if (!window.confirm("Search all 50 states? This existing search uses up to 150 targeted search calls, subject to the configured hourly allowance. Review the settings and smaller targeted-state option first. It does not enroll or email anyone.")) throw new Error("Search cancelled.");
      const res = await apiRequest("POST", "/api/lead-discovery/national-job");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/national-jobs"] });
      toast({ title: "National search started", description: "Searching all 50 states — this will take a while. Progress updates every few seconds." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start national search", variant: "destructive" });
    },
  });

  const startTargetedJobMutation = useMutation({
    mutationFn: async (params: { states: string[]; maxPerState: number; noSoftwareOnly: boolean }) => {
      if (!window.confirm(`Search ${params.states.length} states, keeping up to ${params.maxPerState} results per state? Up to ${params.states.length * 3} search calls, subject to the configured hourly allowance. Contact-detail research is confirmed separately.`)) throw new Error("Search cancelled.");
      const res = await apiRequest("POST", "/api/lead-discovery/national-job", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/national-jobs"] });
      setShowTargetedPanel(false);
      toast({ title: "Targeted search started", description: `Searching ${targetedStates.length} states with ${targetedMaxPerState} result${targetedMaxPerState > 1 ? "s" : ""} per state.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start targeted search", variant: "destructive" });
    },
  });

  const cancelNationalJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/lead-discovery/national-job/${jobId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/national-jobs"] });
      toast({ title: "Cancellation requested" });
    },
  });

  const handleNationalExport = (jobId: string) => {
    window.open(`/api/lead-discovery/national-job/${jobId}/export`, "_blank");
  };

  const filteredNationalResults = nationalStateFilter === "all"
    ? nationalResults
    : nationalResults.filter(r => r.state === nationalStateFilter);

  const nationalStatesPresent = Array.from(new Set(nationalResults.map(r => r.state))).sort();
  // ──────────────────────────────────────────────────────────────────────────

  const createJobMutation = useMutation({
    mutationFn: async (data: { state: string; zipCodes: string }) => {
      const count = data.zipCodes.split(/[,\n]/).filter(zip => zip.trim()).length;
      if (!window.confirm(`Search ${count} ZIP codes and keep up to 20 businesses per ZIP? Up to ${count * 3} search calls, subject to the configured hourly allowance. Details can then be researched in a separately confirmed batch.`)) throw new Error("Search cancelled.");
      const res = await apiRequest("POST", "/api/lead-discovery/jobs", {
        ...data,
        searchEngines: "google_maps",
        maxResultsPerZip: 20,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      refetchConfig();
      setShowNewJobDialog(false);
      setNewJobState("");
      setNewJobZipCodes("");
      toast({ title: "Search started", description: "Lead discovery job has been created and is running." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start search", variant: "destructive" });
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/lead-discovery/jobs/${jobId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      toast({ title: "Job cancelled" });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/lead-discovery/jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      if (selectedJob) setSelectedJob(null);
      toast({ title: "Job deleted" });
    },
  });

  async function stageSavedSearch(jobId:string){
    try{
      const preview=await(await apiRequest("POST",`/api/leads/discovery/${encodeURIComponent(jobId)}/preview`,{})).json();
      let duplicateAction="link";
      if(preview.duplicateCount){
        const choice=window.prompt(`${preview.duplicateCount} saved matches: ${preview.duplicates.slice(0,10).map((row:any)=>row.businessName).join(", ")}.\nChoose skip, link, or update (attach source suggestions only; CRM and approved evidence never change).`,"link");
        if(!choice||!["skip","link","update"].includes(choice.trim().toLowerCase()))return;
        duplicateAction=choice.trim().toLowerCase();
      }
      if(!window.confirm(`Stage ${preview.count} saved businesses in Leads for review? No research, contact creation, enrollment or sending will occur.`))return;
      const result=await(await apiRequest("POST",`/api/leads/discovery/${encodeURIComponent(jobId)}`,{confirmed:true,duplicateAction})).json();
      queryClient.invalidateQueries({queryKey:["/api/leads"]});
      window.location.assign(`/leads/${encodeURIComponent(result.batch.id)}`);
    }catch(error){toast({title:"Could not add saved search",description:error instanceof Error?error.message:"Try again.",variant:"destructive"});}
  }
  const importResultsMutation = useMutation({
    mutationFn: async (resultIds: string[]) => {
      const selected = [...results, ...nationalResults, ...allResults].filter(result => resultIds.includes(result.id));
      if (!selected.length) throw new Error("Select saved search results first.");
      const jobIds = Array.from(new Set(selected.map(result => result.jobId)));
      if (!window.confirm(`Add ${selected.length} businesses to the Leads review queue? Existing matches will be linked, never overwritten. No contacts, enrollment or sending will occur.`)) throw new Error("Cancelled; nothing was added.");
      let lastBatch: any;
      for (const jobId of jobIds) {
        const rowIds=selected.filter(result=>result.jobId===jobId).map(result=>result.id);
        const preview=await(await apiRequest("POST",`/api/leads/discovery/${encodeURIComponent(jobId)}/preview`,{rowIds})).json();
        let duplicateAction="link";
        if(preview.duplicateCount){
          const choice=window.prompt(`${preview.duplicateCount} matching saved leads:\n${preview.duplicates.slice(0,10).map((row:any)=>row.businessName+(row.protected?" (protected)":"")).join("\n")}\nChoose skip, link, or update (attach source suggestions only; never overwrite approved or CRM data). Cancel makes no changes.`, "link");
          if(!choice||!["skip","link","update"].includes(choice.toLowerCase().trim()))throw new Error("Duplicate preview cancelled; choose skip, link, or update.");
          duplicateAction=choice.toLowerCase().trim();
        }
        const res = await apiRequest("POST", `/api/leads/discovery/${encodeURIComponent(jobId)}`, {
          confirmed: true, rowIds, duplicateAction,
        });
        lastBatch = (await res.json()).batch;
      }
      return lastBatch;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setSelectedResults([]);
      toast({ 
        title: "Added to Leads",
        description: "Review source evidence and approve before adding contacts."
      });
      window.location.assign(`/leads/${encodeURIComponent(data.id)}`);
    },
    onError: (error: any) => {
      toast({ title: "Leads were not added", description: error.message, variant: "destructive" });
    },
  });

  const deleteResultMutation = useMutation({
    mutationFn: async (resultId: string) => {
      await apiRequest("DELETE", `/api/lead-discovery/results/${resultId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs", selectedJob?.id, "results"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      toast({ title: "Result deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateJob = () => {
    if (!newJobState || !newJobZipCodes.trim()) {
      toast({ title: "Missing info", description: "Please select a state and enter ZIP codes", variant: "destructive" });
      return;
    }
    
    // Validate ZIP count against limit
    const zipCount = newJobZipCodes.split(/[,\n]/).map(z => z.trim()).filter(z => z).length;
    const maxZips = config?.config?.maxZipsPerRun || 3;
    if (zipCount > maxZips) {
      toast({ 
        title: "Too many ZIP codes", 
        description: `Maximum ${maxZips} ZIP codes allowed per search. You entered ${zipCount}.`, 
        variant: "destructive" 
      });
      return;
    }
    
    // Check if quota is reached
    if (config?.usage?.isQuotaReached) {
      toast({ 
        title: "SERP quota reached", 
        description: "Upgrade to Developer plan to continue searching.", 
        variant: "destructive" 
      });
      return;
    }
    
    createJobMutation.mutate({
      state: newJobState,
      zipCodes: newJobZipCodes,
    });
  };

  const handleExport = (jobId: string) => {
    window.open(`/api/lead-discovery/export/${jobId}`, "_blank");
  };

  const toggleResultSelection = (resultId: string) => {
    const row = results.find(result => result.id === resultId);
    if (!row || eligibilityFor(row).blocked || row.isImported === "true") return;
    setSelectedResults(prev => 
      prev.includes(resultId) 
        ? prev.filter(id => id !== resultId)
        : [...prev, resultId]
    );
  };

  const selectAllResults = () => {
    const importableResults = safeResults;
    if (selectedResults.length === importableResults.length) {
      setSelectedResults([]);
    } else {
      setSelectedResults(importableResults.map(r => r.id));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "running":
        return <Badge variant="default" className="bg-blue-500"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case "completed":
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "cancelled":
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getSoftwareBadge = (usesSoftware: string | null) => {
    switch (usesSoftware) {
      case "Yes":
        return <Badge variant="default" className="bg-green-500">Yes</Badge>;
      case "No":
        return <Badge variant="secondary">No</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Search for Businesses" />
      
      <main className="flex-1 overflow-y-auto p-6">
        {!config?.serpApiConfigured && (
          <Card className="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                API Key Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-yellow-600 dark:text-yellow-300">
                SerpAPI key is not configured. Ask the admin to set the Railway variable SERPAPI_KEY to enable lead discovery searches.
              </p>
            </CardContent>
          </Card>
        )}

        {/* SERP Usage Bar */}
        {config?.usage && (
          <Card className={`mb-6 ${
            config.usage.warningLevel === 'hardstop' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' :
            config.usage.warningLevel === 'red' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' :
            config.usage.warningLevel === 'yellow' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' : ''
          }`}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">SerpAPI Usage:</span>
                  <span className={`font-bold ${
                    config.usage.warningLevel === 'hardstop' ? 'text-red-600' :
                    config.usage.warningLevel === 'red' ? 'text-orange-600' :
                    config.usage.warningLevel === 'yellow' ? 'text-yellow-600' : ''
                  }`}>
                    {config.usage.used} / {config.usage.quota}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {config.config?.planType === 'developer' ? 'Developer Plan' : 'Free Plan'}
                  </Badge>
                </div>
                {isAdmin && (
                  <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="btn-settings">
                        <Settings className="h-4 w-4 mr-1" />
                        Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Lead Discovery Settings</DialogTitle>
                        <DialogDescription>Admin controls for SERP usage and queries</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Enable 3rd Query</Label>
                            <p className="text-xs text-muted-foreground">
                              "Grooming salon in [STATE], Zip code [ZIP]"
                            </p>
                          </div>
                          <Switch
                            checked={config.config?.enableThirdQuery}
                            onCheckedChange={(checked) => updateConfigMutation.mutate({ enableThirdQuery: checked })}
                            data-testid="switch-third-query"
                          />
                        </div>
                        <div className="border-t pt-4">
                          <Label className="text-sm font-medium">Plan Settings</Label>
                          <p className="text-xs text-muted-foreground mb-2">
                            Current plan: {config.config?.planType}
                          </p>
                          {config.config?.planType === 'free' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateConfigMutation.mutate({ planType: 'developer', maxZipsPerRun: 20, queriesPerZip: 3 })}
                              data-testid="btn-upgrade-plan"
                            >
                              Upgrade to Developer Plan
                            </Button>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            Developer plan: 5000 searches/month, 20 ZIPs/run, 3 queries/ZIP
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <Progress 
                value={(config.usage.used / config.usage.quota) * 100} 
                className={`h-2 ${
                  config.usage.warningLevel === 'hardstop' ? '[&>div]:bg-red-500' :
                  config.usage.warningLevel === 'red' ? '[&>div]:bg-orange-500' :
                  config.usage.warningLevel === 'yellow' ? '[&>div]:bg-yellow-500' : ''
                }`}
              />
              {config.usage.isQuotaReached && (
                <p className="text-sm text-red-600 mt-2 font-medium">
                  SERP quota reached – upgrade required to continue searching
                </p>
              )}
              {config.usage.warningLevel === 'red' && !config.usage.isQuotaReached && (
                <p className="text-sm text-orange-600 mt-2">
                  Warning: {config.usage.hardStopAt - config.usage.used} searches remaining before hard stop
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex justify-between items-center">
            <TabsList>
              <TabsTrigger value="jobs" data-testid="tab-jobs">Search Jobs</TabsTrigger>
              <TabsTrigger value="results" data-testid="tab-results" disabled={!selectedJob}>
                Results {selectedJob && `(${results.length})`}
              </TabsTrigger>
              <TabsTrigger value="all-results" data-testid="tab-all-results">
                <List className="h-3.5 w-3.5 mr-1.5" />
                All Results
              </TabsTrigger>
              <TabsTrigger value="national" data-testid="tab-national">
                <Globe className="h-3.5 w-3.5 mr-1.5" />
                National Search
                {activeNationalJob && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] text-white leading-none">
                    {activeNationalJob.statesCompleted}/{activeNationalJob.statesTotal}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <Dialog open={showNewJobDialog} onOpenChange={setShowNewJobDialog}>
              <DialogTrigger asChild>
                <Button disabled={!config?.serpApiConfigured} data-testid="btn-new-search">
                  <Plus className="h-4 w-4 mr-2" />
                  New Search
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Start Lead Discovery Search</DialogTitle>
                  <DialogDescription>
                    Search for pet grooming businesses in specific ZIP codes
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>State</Label>
                    <Select value={newJobState} onValueChange={setNewJobState}>
                      <SelectTrigger data-testid="select-state">
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent>
                        {US_STATES.map(state => (
                          <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>ZIP Codes (comma-separated or one per line)</Label>
                    <Textarea
                      value={newJobZipCodes}
                      onChange={(e) => setNewJobZipCodes(e.target.value)}
                      placeholder="10001, 10002, 10003&#10;or paste from CSV"
                      rows={4}
                      data-testid="input-zipcodes"
                    />
                  </div>

                  {config?.config && (
                    <div className="text-sm p-3 bg-muted rounded-md space-y-1">
                      <p><strong>Limits:</strong></p>
                      <p>• Max {config.config.maxZipsPerRun} ZIP codes per search</p>
                      <p>• {config.config.queriesPerZip} queries per ZIP ({config.config.enableThirdQuery ? "3rd query enabled" : "2 default"})</p>
                      <p>• Uses Google Maps search engine</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowNewJobDialog(false)}>Cancel</Button>
                    <Button 
                      onClick={handleCreateJob} 
                      disabled={createJobMutation.isPending || !newJobState || !newJobZipCodes.trim()}
                      data-testid="btn-start-search"
                    >
                      {createJobMutation.isPending ? "Starting..." : "Start Search"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <TabsContent value="jobs" className="space-y-4">
            {jobsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No search jobs yet</h3>
                  <p className="text-muted-foreground mb-4">Start a new search to find pet grooming businesses</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {jobs.map(job => (
                  <Card key={job.id} className={selectedJob?.id === job.id ? "ring-2 ring-primary" : ""}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-lg">
                            {job.state} — {job.totalZipCodes} ZIP {job.totalZipCodes === 1 ? "code" : "codes"}
                          </CardTitle>
                          <CardDescription className="space-y-0.5">
                            <span className="block">
                              ZIPs: <span className="font-medium text-foreground/80">
                                {(() => {
                                  const zips = (job.zipCodes || "").split(",").map((z: string) => z.trim()).filter(Boolean);
                                  if (zips.length <= 5) return zips.join(", ");
                                  return `${zips.slice(0, 5).join(", ")} +${zips.length - 5} more`;
                                })()}
                              </span>
                            </span>
                            <span className="block">
                              Created {new Date(job.createdAt!).toLocaleString()} · ID: {job.id.substring(0, 8)}
                            </span>
                          </CardDescription>
                        </div>
                        {getStatusBadge(job.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {job.status === "running" && (
                        <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span>Processing ZIP codes</span>
                            <span>{job.processedZipCodes} / {job.totalZipCodes}</span>
                          </div>
                          <Progress value={(job.processedZipCodes! / job.totalZipCodes!) * 100} />
                        </div>
                      )}
                      
                      <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                        <span>Found: {job.totalBusinessesFound || 0}</span>
                        <span>Duplicates removed: {job.duplicatesRemoved || 0}</span>
                        <span>Engines: {job.searchEngines}</span>
                      </div>

                      {job.errorMessage && (
                        <p className="text-sm text-red-500 mb-4">{job.errorMessage}</p>
                      )}

                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setSelectedJob(job);
                            setActiveTab("results");
                          }}
                          data-testid={`btn-view-results-${job.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View Results
                        </Button>
                        {job.status === "completed" && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleExport(job.id)}
                            data-testid={`btn-export-${job.id}`}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Export CSV
                          </Button>
                        )}
                        {job.status === "running" && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => cancelJobMutation.mutate(job.id)}
                            data-testid={`btn-cancel-${job.id}`}
                          >
                            Cancel
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => deleteJobMutation.mutate(job.id)}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`btn-delete-${job.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            {selectedJob && (
              <>
                <EligibilitySummaryStrip summary={resultEligibilitySummary} label="Search results eligibility" />
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">Results for {selectedJob.state}</h3>
                    <p className="text-sm text-muted-foreground">
                      {safeResults.length} available to import · {results.filter(r => eligibilityFor(r).blocked).length} blocked for grooming review
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllResults}
                      disabled={safeResults.length === 0}
                      data-testid="btn-select-all"
                    >
                      {selectedResults.length === safeResults.length
                        ? "Deselect All" 
                        : "Select All"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => importResultsMutation.mutate(selectedResults)}
                      disabled={selectedResults.length === 0 || importResultsMutation.isPending || selectedResults.some(id => !results.some(row => row.id === id && !eligibilityFor(row).blocked))}
                      data-testid="btn-import-selected"
                    >
                      <Upload className="h-4 w-4 mr-1" />
                      Add to Leads ({selectedResults.length})
                    </Button>
                  </div>
                </div>

                {resultsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading results...</div>
                ) : results.length === 0 ? (
                  <Card>
                    <CardContent className="text-center py-8 text-muted-foreground">
                      No results found for this search job
                    </CardContent>
                  </Card>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Business</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Website</TableHead>
                          <TableHead>Uses Software</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.map(result => (
                          <TableRow key={result.id} className={result.isImported === "true" ? "opacity-50" : ""}>
                            <TableCell>
                              <Checkbox
                                checked={selectedResults.includes(result.id)}
                                onCheckedChange={() => toggleResultSelection(result.id)}
                                disabled={result.isImported === "true" || eligibilityFor(result).blocked}
                                data-testid={`checkbox-result-${result.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{result.company}</div>
                              <div className="text-sm text-muted-foreground">{result.zipCode}</div>
                              <div className="mt-2 min-w-[290px]"><DirectoryEligibilityReview row={result as unknown as EligibilityRow} endpoint={`/api/lead-discovery/results/${encodeURIComponent(result.id)}/eligibility`} compact invalidateKeys={[["/api/lead-discovery/jobs", selectedJob?.id, "results"], ["/api/lead-discovery/jobs"], ["/api/lead-discovery/all-results"]]} /></div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{result.phone || "-"}</div>
                              <div className="text-sm text-muted-foreground">{result.email || "-"}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm max-w-[150px] truncate" title={result.address || ""}>
                                {result.address || "-"}
                              </div>
                            </TableCell>
                            <TableCell>
                              {result.websiteUrl ? (
                                <a 
                                  href={result.websiteUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline text-sm truncate max-w-[150px] block"
                                  data-testid={`link-website-${result.id}`}
                                >
                                  {new URL(result.websiteUrl).hostname}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>{getSoftwareBadge(result.usesSoftware)}</TableCell>
                            <TableCell>
                              {result.isImported === "true" ? (
                                <Badge variant="outline" className="text-green-600">Imported</Badge>
                              ) : eligibilityFor(result).blocked ? (
                                <Badge variant="destructive">Grooming review</Badge>
                              ) : (
                                <Badge variant="secondary">Ready</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setViewDetailsResult(result)}
                                  data-testid={`btn-view-details-${result.id}`}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {result.isImported === "true" && result.importedContactId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setLocation(`/contacts?edit=${result.importedContactId}`)}
                                    data-testid={`btn-edit-contact-${result.id}`}
                                    title="Edit contact profile"
                                  >
                                    <Pencil className="h-4 w-4 text-blue-500" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteResultMutation.mutate(result.id)}
                                  disabled={deleteResultMutation.isPending}
                                  data-testid={`btn-delete-result-${result.id}`}
                                  title="Delete result"
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── All Results Tab ─────────────────────────────────────────── */}
          <TabsContent value="all-results" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">All Results</h3>
                <p className="text-sm text-muted-foreground">
                  {allResultsLoading ? "Loading…" : `${allResults.length} total results across all searches`}
                </p>
              </div>
            </div>
            <EligibilitySummaryStrip summary={allEligibilitySummary} label="All results eligibility" />
            {allResultsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading all results…</div>
            ) : allResults.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8 text-muted-foreground">
                  No results found. Run a search job to discover businesses.
                </CardContent>
              </Card>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Business</TableHead>
                      <TableHead>Search Term</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Uses Software</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allResults.map(result => (
                      <TableRow key={result.id} className={result.isImported === "true" ? "opacity-60" : ""}>
                        <TableCell>
                          <div className="font-medium">{result.company}</div>
                          <div className="text-sm text-muted-foreground">{result.zipCode}</div>
                          <div className="mt-2 min-w-[290px]"><DirectoryEligibilityReview row={result as unknown as EligibilityRow} endpoint={`/api/lead-discovery/results/${encodeURIComponent(result.id)}/eligibility`} compact invalidateKeys={[["/api/lead-discovery/all-results"], ["/api/lead-discovery/jobs"]]} /></div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground max-w-[160px] leading-relaxed">
                            {result.searchQuery || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{result.phone || "-"}</div>
                          <div className="text-sm text-muted-foreground">{result.email || "-"}</div>
                        </TableCell>
                        <TableCell>
                          {result.websiteUrl ? (
                            <a
                              href={result.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline text-sm truncate max-w-[140px] block"
                            >
                              {(() => { try { return new URL(result.websiteUrl).hostname; } catch { return result.websiteUrl; } })()}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{getSoftwareBadge(result.usesSoftware)}</TableCell>
                        <TableCell>
                          {result.isImported === "true" ? (
                            <Badge variant="outline" className="text-green-600">Imported</Badge>
                          ) : eligibilityFor(result).blocked ? (
                            <Badge variant="destructive">Grooming review</Badge>
                          ) : (
                            <Badge variant="secondary">Ready</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewDetailsResult(result)}
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {result.isImported === "true" && result.importedContactId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setLocation(`/contacts?edit=${result.importedContactId}`)}
                                title="Edit contact profile"
                              >
                                <Pencil className="h-4 w-4 text-blue-500" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── National Search Tab ─────────────────────────────────────── */}
          <TabsContent value="national" className="space-y-4">
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-lg">National Search</h3>
                <p className="text-sm text-muted-foreground">
                  Find grooming businesses across the US — all 50 states or a targeted subset.
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {latestNationalJob && latestNationalJob.leadsFound > 0 && <Button onClick={()=>stageSavedSearch(latestNationalJob.id)}>Add saved results to Leads</Button>}
                {latestNationalJob && latestNationalJob.leadsFound > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => handleNationalExport(latestNationalJob.id)}
                    data-testid="btn-national-export"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export All to Excel ({latestNationalJob.leadsFound})
                  </Button>
                )}
                {activeNationalJob ? (
                  <Button
                    variant="outline"
                    onClick={() => cancelNationalJobMutation.mutate(activeNationalJob.id)}
                    disabled={cancelNationalJobMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Search
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Pre-populate with states not yet covered by the latest job
                        const covered = new Set(nationalStatesPresent);
                        const missing = US_STATES.map(s => s.code).filter(c => !covered.has(c));
                        setTargetedStates(missing.length > 0 ? missing : US_STATES.map(s => s.code));
                        setShowTargetedPanel(prev => !prev);
                      }}
                      data-testid="btn-show-targeted-search"
                    >
                      <Search className="h-4 w-4 mr-2" />
                      Targeted Search
                    </Button>
                    <Button
                      onClick={() => startNationalJobMutation.mutate()}
                      disabled={startNationalJobMutation.isPending || !config?.serpApiConfigured || config?.usage?.isQuotaReached}
                      data-testid="btn-start-national-search"
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      {startNationalJobMutation.isPending ? "Starting…" : "Run All 50 States"}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Targeted Search panel */}
            {showTargetedPanel && !activeNationalJob && (
              <Card className="border-dashed border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Targeted Search
                  </CardTitle>
                  <CardDescription>
                    Pick specific states, cap results per state, and filter out salons that already use booking software.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* State multi-select */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">States to search ({targetedStates.length} selected)</Label>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setTargetedStates(US_STATES.map(s => s.code))}
                        >
                          Select all
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setTargetedStates([])}
                        >
                          Clear
                        </Button>
                        {nationalStatesPresent.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs px-2 text-blue-600"
                            onClick={() => {
                              const covered = new Set(nationalStatesPresent);
                              setTargetedStates(US_STATES.map(s => s.code).filter(c => !covered.has(c)));
                            }}
                          >
                            Missing only
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-6 gap-1 max-h-40 overflow-y-auto border rounded p-2 bg-muted/30">
                      {US_STATES.map(state => (
                        <label
                          key={state.code}
                          className={`flex items-center justify-center gap-1 text-xs cursor-pointer rounded px-1 py-0.5 transition-colors ${
                            targetedStates.includes(state.code)
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={targetedStates.includes(state.code)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTargetedStates(prev => [...prev, state.code]);
                              } else {
                                setTargetedStates(prev => prev.filter(s => s !== state.code));
                              }
                            }}
                          />
                          {state.code}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Controls row */}
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <Label className="text-sm">Results per state</Label>
                      <Select
                        value={String(targetedMaxPerState)}
                        onValueChange={(v) => setTargetedMaxPerState(Number(v))}
                      >
                        <SelectTrigger className="w-24 mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2 pb-1">
                      <Switch
                        id="no-software-only"
                        checked={targetedNoSoftwareOnly}
                        onCheckedChange={setTargetedNoSoftwareOnly}
                      />
                      <div>
                        <Label htmlFor="no-software-only" className="text-sm cursor-pointer">No-software leads only</Label>
                        <p className="text-xs text-muted-foreground">Skip salons that already use MoeGo, Booksy, etc.</p>
                      </div>
                    </div>

                    <div className="ml-auto text-right pb-1">
                      <p className="text-xs text-muted-foreground">
                        ~{targetedStates.length} SERP credit{targetedStates.length !== 1 ? "s" : ""} &bull; {targetedStates.length} state{targetedStates.length !== 1 ? "s" : ""} × 1 call each
                      </p>
                      {config?.usage && (
                        <p className={`text-xs font-medium ${
                          (config.usage.used + targetedStates.length) >= config.usage.hardStopAt
                            ? "text-red-600"
                            : (config.usage.used + targetedStates.length) >= config.usage.quota * 0.7
                            ? "text-orange-500"
                            : "text-green-600"
                        }`}>
                          {config.usage.used} used + {targetedStates.length} = {config.usage.used + targetedStates.length} / {config.usage.hardStopAt} limit
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1 border-t">
                    <Button variant="ghost" onClick={() => setShowTargetedPanel(false)}>Cancel</Button>
                    <Button
                      onClick={() => startTargetedJobMutation.mutate({
                        states: targetedStates,
                        maxPerState: targetedMaxPerState,
                        noSoftwareOnly: targetedNoSoftwareOnly,
                      })}
                      disabled={
                        targetedStates.length === 0 ||
                        startTargetedJobMutation.isPending ||
                        !config?.serpApiConfigured ||
                        config?.usage?.isQuotaReached
                      }
                      data-testid="btn-run-targeted-search"
                    >
                      <Search className="h-4 w-4 mr-2" />
                      {startTargetedJobMutation.isPending ? "Starting…" : `Run ${targetedStates.length} State${targetedStates.length !== 1 ? "s" : ""}`}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active job progress */}
            {activeNationalJob && (
              <Card className="border-blue-300 bg-blue-50 dark:bg-blue-900/20">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                      Searching…
                    </span>
                    <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                      {activeNationalJob.statesCompleted} / {activeNationalJob.statesTotal} states
                    </span>
                  </div>
                  <Progress
                    value={(activeNationalJob.statesCompleted / activeNationalJob.statesTotal) * 100}
                    className="h-2 [&>div]:bg-blue-500"
                  />
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    {activeNationalJob.leadsFound} leads found so far — results appear below as states complete
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Past job summary cards */}
            {nationalJobs.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {nationalJobs.map(job => (
                  <Card
                    key={job.id}
                    className={`flex-1 min-w-[220px] max-w-xs cursor-pointer ${latestNationalJob?.id === job.id ? "ring-2 ring-primary" : ""}`}
                  >
                    <CardContent className="pt-3 pb-3 px-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {new Date(job.createdAt!).toLocaleDateString()}
                        </span>
                        {job.status === "completed" && <Badge variant="default" className="bg-green-500 text-xs"><CheckCircle className="w-3 h-3 mr-1" />Done</Badge>}
                        {job.status === "running"   && <Badge variant="default" className="bg-blue-500 text-xs"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Running</Badge>}
                        {job.status === "cancelled" && <Badge variant="outline" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>}
                        {job.status === "failed"    && <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>}
                      </div>
                      <p className="text-sm font-medium">{job.leadsFound} leads &bull; {job.statesCompleted}/{job.statesTotal} states</p>
                      {/* Targeted search metadata */}
                      {job.targetStates && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          <Badge variant="secondary" className="text-xs">{job.statesTotal} states</Badge>
                          <Badge variant="secondary" className="text-xs">{job.maxPerState}/state</Badge>
                          {job.noSoftwareOnly === "true" && (
                            <Badge variant="outline" className="text-xs text-green-700 border-green-400">No-software only</Badge>
                          )}
                        </div>
                      )}
                      {job.errorMessage && <p className="text-xs text-red-500 truncate">{job.errorMessage}</p>}
                      {job.leadsFound > 0 && <Button size="sm" variant="outline" onClick={e=>{e.stopPropagation();stageSavedSearch(job.id);}}>Add saved results to Leads</Button>}
                      {/* Export button per job */}
                      {job.leadsFound > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2 mt-1"
                          onClick={(e) => { e.stopPropagation(); handleNationalExport(job.id); }}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Results section */}
            {latestNationalJob && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {nationalResultsLoading ? "Loading…" : `${filteredNationalResults.length} leads${nationalStateFilter !== "all" ? ` in ${nationalStateFilter}` : " across all states"}`}
                  </span>
                  {nationalStatesPresent.length > 0 && (
                    <Select value={nationalStateFilter} onValueChange={setNationalStateFilter}>
                      <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-national-state-filter">
                        <SelectValue placeholder="Filter by state" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All states</SelectItem>
                        {nationalStatesPresent.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <EligibilitySummaryStrip summary={nationalEligibilitySummary} label="National results eligibility" />

                {nationalResultsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading results…</div>
                ) : filteredNationalResults.length === 0 ? (
                  <Card>
                    <CardContent className="text-center py-8 text-muted-foreground">
                      {nationalResults.length === 0
                        ? "No results yet — start a national search or wait for the current one to progress."
                        : `No results for ${nationalStateFilter}.`}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">State</TableHead>
                          <TableHead>Business</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Website</TableHead>
                          <TableHead>Uses Software</TableHead>
                          <TableHead>Software</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNationalResults.map(result => (
                          <TableRow key={result.id} className={result.isImported === "true" ? "opacity-60" : ""}>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">{result.state}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{result.company}</div>
                              <div className="text-xs text-muted-foreground">{result.zipCode}</div>
                              <div className="mt-2 min-w-[290px]"><DirectoryEligibilityReview row={result as unknown as EligibilityRow} endpoint={`/api/lead-discovery/results/${encodeURIComponent(result.id)}/eligibility`} compact invalidateKeys={[["/api/lead-discovery/national-job"], ["/api/lead-discovery/jobs"], ["/api/lead-discovery/all-results"]]} /></div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{result.phone || "-"}</div>
                              <div className="text-xs text-muted-foreground">{result.email || "-"}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm max-w-[140px] truncate" title={result.address || ""}>
                                {result.address || "-"}
                              </div>
                            </TableCell>
                            <TableCell>
                              {result.websiteUrl ? (
                                <a
                                  href={result.websiteUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline text-sm truncate max-w-[130px] block"
                                >
                                  {(() => { try { return new URL(result.websiteUrl).hostname; } catch { return result.websiteUrl; } })()}
                                </a>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>{getSoftwareBadge(result.usesSoftware)}</TableCell>
                            <TableCell>
                              <span className="text-sm">{result.currentSoftware || "-"}</span>
                            </TableCell>
                            <TableCell>
                              {result.isImported === "true"
                                ? <Badge variant="outline" className="text-green-600 text-xs">Imported</Badge>
                                : eligibilityFor(result).blocked
                                  ? <Badge variant="destructive" className="text-xs">Grooming review</Badge>
                                : <Badge variant="secondary" className="text-xs">Ready</Badge>}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setViewDetailsResult(result)}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {result.isImported === "true" && result.importedContactId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setLocation(`/contacts?edit=${result.importedContactId}`)}
                                    title="Edit contact"
                                  >
                                    <Pencil className="h-4 w-4 text-blue-500" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {nationalJobs.length === 0 && !startNationalJobMutation.isPending && (
              <Card>
                <CardContent className="text-center py-12">
                  <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No national searches yet</h3>
                  <p className="text-muted-foreground mb-4 text-sm max-w-md mx-auto">
                    Click <strong>Run National Search</strong> to automatically find 3 grooming businesses in each of the 50 US states.
                    Results include business name, address, website, software detection, and more — exportable as a single Excel file.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* View Details Dialog */}
        <Dialog open={!!viewDetailsResult} onOpenChange={(open) => !open && setViewDetailsResult(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewDetailsResult?.company || "Business Details"}</DialogTitle>
              <DialogDescription>All information found from SERP search</DialogDescription>
            </DialogHeader>
            {viewDetailsResult && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Business Name</Label>
                    <p className="font-medium">{viewDetailsResult.company || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">ZIP Code</Label>
                    <p className="font-medium">{viewDetailsResult.zipCode || "-"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Phone</Label>
                    <p className="font-medium">{viewDetailsResult.phone || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Email</Label>
                    <p className="font-medium">{viewDetailsResult.email || "-"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-medium">{viewDetailsResult.address || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Website</Label>
                  {viewDetailsResult.websiteUrl ? (
                    <a href={viewDetailsResult.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block">
                      {viewDetailsResult.websiteUrl}
                    </a>
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Uses Software</Label>
                    <p className="font-medium">{viewDetailsResult.usesSoftware || "Unknown"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Current Software</Label>
                    <p className="font-medium">{viewDetailsResult.currentSoftware || "-"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Booking Software URL</Label>
                  {viewDetailsResult.bookingSoftwareUrl ? (
                    <a href={viewDetailsResult.bookingSoftwareUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block">
                      {viewDetailsResult.bookingSoftwareUrl}
                    </a>
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Contact Request Form URL</Label>
                  {viewDetailsResult.contactRequestFormUrl ? (
                    <a href={viewDetailsResult.contactRequestFormUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block">
                      {viewDetailsResult.contactRequestFormUrl}
                    </a>
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Google Business Profile</Label>
                  {viewDetailsResult.googleBusinessProfileUrl ? (
                    <a href={viewDetailsResult.googleBusinessProfileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block">
                      View Profile
                    </a>
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Lead Source</Label>
                    <p className="font-medium">{viewDetailsResult.leadSource || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Search Query</Label>
                    <p className="font-medium">{viewDetailsResult.searchQuery || "-"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="font-medium">{viewDetailsResult.notes || "-"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Crawl Status</Label>
                    <p className="font-medium">{viewDetailsResult.crawlStatus || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Import Status</Label>
                    <p className="font-medium">{viewDetailsResult.isImported === "true" ? "Imported" : "Not Imported"}</p>
                  </div>
                </div>
                {viewDetailsResult.crawlError && (
                  <div>
                    <Label className="text-muted-foreground">Crawl Error</Label>
                    <p className="text-red-500">{viewDetailsResult.crawlError}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
