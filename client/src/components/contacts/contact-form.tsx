import { useState, useRef } from "react";
import { Search, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { insertContactSchema, type Contact, type InsertContact } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { DuplicateResolutionDialog } from "./duplicate-resolution-dialog";
import { LEAD_LISTS, leadTypesForList } from "@shared/leadTypes";
import { useIndustries } from "@/hooks/useIndustries";

interface ContactFormProps {
  contact?: Contact;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ContactForm({ contact, onSuccess, onCancel }: ContactFormProps) {
  const { toast } = useToast();
  const [duplicates, setDuplicates] = useState<Contact[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingContactData, setPendingContactData] = useState<InsertContact | null>(null);
  const [ownerSearch, setOwnerSearch] = useState<{
    status: "idle" | "loading" | "found" | "not_found";
    firstName?: string;
    source?: string;
    confidence?: string;
    steps?: { label: string; result: string }[];
  }>({ status: "idle" });

  const discoverOwnerMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/contacts/${contact?.id}/discover-owner`, {}); return res.json(); },
    onMutate: () => setOwnerSearch({ status: "loading" }),
    onSuccess: (data: any) => {
      if (data.found) {
        setOwnerSearch({ status: "found", firstName: data.firstName, source: data.source, confidence: data.confidence, steps: data.steps });
      } else {
        setOwnerSearch({ status: "not_found", steps: data.steps });
      }
    },
    onError: () => setOwnerSearch({ status: "not_found" }),
  });
  
  const { groups, typesFor } = useIndustries();
  const form = useForm<InsertContact>({
    resolver: zodResolver(insertContactSchema),
    defaultValues: {
      firstName: contact?.firstName || "",
      lastName: contact?.lastName || "",
      useBusinessNameForEmail: contact?.useBusinessNameForEmail || "No",
      email: contact?.email || "",
      phone: contact?.phone || "",
      phoneCell: contact?.phoneCell || "",
      phoneWork: contact?.phoneWork || "",
      phoneOther: contact?.phoneOther || "",
      address: contact?.address || "",
      city: contact?.city || "",
      state: contact?.state || "",
      zipCode: contact?.zipCode || "",
      company: contact?.company || "",
      jobTitle: contact?.jobTitle || "",
      industryGroup: contact?.industryGroup || "",
      industryType: contact?.industryType || "",
      leadList: (contact?.leadList || "") as "get_seen" | "ordering" | "",
      leadType: contact?.leadType || "",
      hasWebsite: contact?.hasWebsite || "",
      websiteUrl: contact?.websiteUrl || "",
      contactRequestFormUrl: contact?.contactRequestFormUrl || "",
      facebookUrl: contact?.facebookUrl || "",
      instagramHandle: contact?.instagramHandle || "",
      secondaryFirstName: contact?.secondaryFirstName || "",
      secondaryLastName: contact?.secondaryLastName || "",
      leadSource: contact?.leadSource || "",
      numberOfEmployees: contact?.numberOfEmployees || undefined,
      numberOfLocations: contact?.numberOfLocations || undefined,
      painPoints: contact?.painPoints || "",
      interestLevel: contact?.interestLevel || "",
      notes: contact?.notes || "",
      status: contact?.status || "active",
    },
  });

  const checkDuplicatesMutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      const response = await apiRequest("POST", "/api/contacts/check-duplicates", { 
        contact: data,
        excludeId: contact?.id
      });
      const result: any = await response.json();
      return result.duplicates as Contact[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      if (contact) {
        return apiRequest("PUT", `/api/contacts/${contact.id}`, data);
      } else {
        return apiRequest("POST", "/api/contacts", data);
      }
    },
    onSuccess: () => {
      toast({
        title: contact ? "Contact updated" : "Contact created",
        description: `${[form.getValues("firstName"), form.getValues("lastName")].filter(Boolean).join(" ") || form.getValues("company") || "Contact"} has been ${contact ? "updated" : "added"} successfully.`,
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${contact ? "update" : "create"} contact`,
        variant: "destructive",
      });
    },
  });

  const createContact = (data: InsertContact) => {
    mutation.mutate(data);
  };

  const onSubmit = async (data: InsertContact) => {
    if (contact) {
      mutation.mutate(data);
      return;
    }

    try {
      const foundDuplicates = await checkDuplicatesMutation.mutateAsync(data);
      
      if (foundDuplicates && foundDuplicates.length > 0) {
        setDuplicates(foundDuplicates);
        setPendingContactData(data);
        setShowDuplicateDialog(true);
      } else {
        createContact(data);
      }
    } catch (error) {
      console.error("Error checking duplicates:", error);
      toast({
        title: "Error checking duplicates",
        description: "Could not check for duplicates. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddAnyway = () => {
    if (pendingContactData) {
      createContact(pendingContactData);
      setPendingContactData(null);
    }
  };

  const handleOverride = async (contactId: string) => {
    if (pendingContactData) {
      const response = await apiRequest("PUT", `/api/contacts/${contactId}`, pendingContactData);
      toast({
        title: "Contact updated",
        description: `${[pendingContactData.firstName, pendingContactData.lastName].filter(Boolean).join(" ") || pendingContactData.company || "Contact"} has been updated successfully.`,
      });
      setPendingContactData(null);
      onSuccess();
    }
  };

  const handleCancel = () => {
    setPendingContactData(null);
    setDuplicates([]);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="contact-form">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Primary Contact</h3>

          <FormField
            control={form.control}
            name="useBusinessNameForEmail"
            render={({ field }) => {
              const checked = field.value === "Yes";
              return (
                <FormItem>
                  <div
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors select-none ${
                      checked
                        ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30"
                        : "border-muted bg-muted/20 hover:bg-muted/40"
                    }`}
                    onClick={() => field.onChange(checked ? "No" : "Yes")}
                    data-testid="toggle-use-business-name"
                  >
                    <div className={`mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked ? "border-amber-500 bg-amber-500" : "border-muted-foreground bg-background"
                    }`}>
                      {checked && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">No first or last name — use business name in emails</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {checked
                          ? "Email greetings will use the business name instead of a personal name."
                          : "Check this if you can't find the contact's name. The business name will be used for [Contact_First_Name] tokens in all sequences."}
                      </p>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          {/* Owner name discovery — only available when editing an existing contact */}
          {contact?.id && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs gap-2 border-dashed"
                onClick={() => discoverOwnerMutation.mutate()}
                disabled={ownerSearch.status === "loading"}
                data-testid="button-discover-owner"
              >
                {ownerSearch.status === "loading" ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Google & website...</>
                ) : (
                  <><Search className="h-3.5 w-3.5" /> Search for Owner's First Name</>
                )}
              </Button>

              {ownerSearch.status === "found" && (
                <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                        Found: <span className="font-bold">{ownerSearch.firstName}</span>
                        {ownerSearch.confidence === "high" && <span className="ml-1.5 text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded-full">High confidence</span>}
                        {ownerSearch.confidence === "medium" && <span className="ml-1.5 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-1.5 py-0.5 rounded-full">Verify before sending</span>}
                        {ownerSearch.confidence === "low" && <span className="ml-1.5 text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-1.5 py-0.5 rounded-full">Low confidence</span>}
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Source: {ownerSearch.source}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => {
                        form.setValue("firstName", ownerSearch.firstName!);
                        form.setValue("useBusinessNameForEmail", "No");
                        setOwnerSearch({ status: "idle" });
                      }}
                      data-testid="button-accept-owner-name"
                    >
                      Accept — use "{ownerSearch.firstName}"
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setOwnerSearch({ status: "idle" })}
                      data-testid="button-dismiss-owner-name"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              {ownerSearch.status === "not_found" && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">No owner name found — please enter manually</p>
                    </div>
                  </div>
                  {ownerSearch.steps && ownerSearch.steps.length > 0 && (
                    <div className="ml-6 space-y-1">
                      {ownerSearch.steps.map((step, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <span className="text-amber-500 dark:text-amber-400 font-bold shrink-0">✓</span>
                          <span className="font-medium text-amber-800 dark:text-amber-200 shrink-0">{step.label}:</span>
                          <span className="text-amber-600 dark:text-amber-400">{step.result}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {form.watch("useBusinessNameForEmail") !== "Yes" && (
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="John"
                        data-testid="input-firstName"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="Smith"
                        data-testid="input-lastName"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {form.watch("useBusinessNameForEmail") === "Yes" && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 flex items-center gap-2">
              <svg className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
              </svg>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Sequence emails will greet this contact using their <strong>business name</strong> instead of a personal name.
                Make sure the <strong>Business / Company</strong> field is filled in below.
              </p>
            </div>
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="email"
                    placeholder="john@company.com"
                    data-testid="input-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Phone Numbers</h3>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="(555) 000-0000"
                    data-testid="input-phone"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="phoneCell"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cell</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      data-testid="input-phoneCell"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phoneWork"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      data-testid="input-phoneWork"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phoneOther"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Other</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      data-testid="input-phoneOther"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    placeholder="123 Main St"
                    data-testid="input-address"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ""}
                      data-testid="input-city"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ""}
                      maxLength={2}
                      className="uppercase"
                      onChange={e => field.onChange(e.target.value.toUpperCase())}
                      data-testid="input-state"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="zipCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zip Code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ""}
                      data-testid="input-zipCode"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Company Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Acme Corp"
                      data-testid="input-company"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="jobTitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Title</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Owner"
                      data-testid="input-jobTitle"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="industryGroup"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(v === "__none" ? "" : v);
                      const type = form.getValues("industryType");
                      if (type && !typesFor(v).includes(type)) form.setValue("industryType", "");
                    }}
                    value={field.value || "__none"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-industryGroup"><SelectValue placeholder="Not set" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none">Not set</SelectItem>
                      {field.value && !groups.includes(field.value) && <SelectItem value={field.value}>{field.value}</SelectItem>}
                      {groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="industryType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type of business</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === "__none" ? "" : v)} value={field.value || "__none"} disabled={!form.watch("industryGroup")}>
                    <FormControl>
                      <SelectTrigger data-testid="select-industryType"><SelectValue placeholder="Not set" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none">Not set</SelectItem>
                      {field.value && !typesFor(form.watch("industryGroup")).includes(field.value) && <SelectItem value={field.value}>{field.value}</SelectItem>}
                      {typesFor(form.watch("industryGroup")).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="leadList"
            render={({ field }) => (
              <FormItem>
                <FormLabel>List</FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(v);
                    const type = form.getValues("leadType");
                    if (type && !leadTypesForList(v).some(t => t.value === type)) form.setValue("leadType", "");
                  }}
                  value={field.value || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-leadList">
                      <SelectValue placeholder="Get Seen or Ordering..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LEAD_LISTS.map(l => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="leadType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lead type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ""}>
                  <FormControl>
                    <SelectTrigger data-testid="select-leadType">
                      <SelectValue placeholder="Select lead type..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {leadTypesForList(form.watch("leadList")).map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="numberOfEmployees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel># of Employees</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="number"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                      placeholder="e.g., 5"
                      data-testid="input-numberOfEmployees"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="numberOfLocations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel># of Locations</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="number"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                      placeholder="e.g., 3"
                      data-testid="input-numberOfLocations"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Social Media & Web</h3>
          <div className="grid grid-cols-1 gap-4">
            <FormField
              control={form.control}
              name="hasWebsite"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Has Website</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value || ""}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-hasWebsite">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Yes">Yes</SelectItem>
                      <SelectItem value="No">No</SelectItem>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="websiteUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website Address</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="https://www.example.com"
                      data-testid="input-websiteUrl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contactRequestFormUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Request Form URL</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="https://www.example.com/contact"
                      data-testid="input-contactRequestFormUrl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="facebookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Facebook Page URL</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        value={field.value || ""}
                        placeholder="https://facebook.com/..."
                        data-testid="input-facebookUrl"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="instagramHandle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram Handle</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        value={field.value || ""}
                        placeholder="@username"
                        data-testid="input-instagramHandle"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Secondary Contact Person</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="secondaryFirstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Jane"
                      data-testid="input-secondaryFirstName"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="secondaryLastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Doe"
                      data-testid="input-secondaryLastName"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <FormField
            control={form.control}
            name="painPoints"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pain Points</FormLabel>
                <FormControl>
                  <Textarea 
                    {...field} 
                    value={field.value || ""}
                    placeholder="Describe customer pain points, challenges, or concerns..."
                    className="min-h-[100px]"
                    data-testid="textarea-painPoints"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="interestLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Interest Level</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-interestLevel">
                        <SelectValue placeholder="Select interest level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="leadSource"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Source</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-leadSource">
                        <SelectValue placeholder="Select lead source" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Inbound">Inbound</SelectItem>
                      <SelectItem value="Outbound">Outbound</SelectItem>
                      <SelectItem value="Cold Call">Cold Call</SelectItem>
                      <SelectItem value="Facebook Ad">Facebook Ad</SelectItem>
                      <SelectItem value="Referral">Referral</SelectItem>
                      <SelectItem value="Event">Event</SelectItem>
                      <SelectItem value="TownGrid Website Form">TownGrid Website Form</SelectItem>
                      <SelectItem value="Google Search">Google Search</SelectItem>
                      <SelectItem value="CRM - Lead Discovery">CRM - Lead Discovery</SelectItem>
                      <SelectItem value="Sales Person acquired">Sales Person acquired</SelectItem>
                      <SelectItem value="Assigned to Sales Person">Assigned to Sales Person</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea 
                    {...field} 
                    value={field.value || ""}
                    placeholder="Additional notes about this contact..."
                    className="min-h-[100px]"
                    data-testid="textarea-notes"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end space-x-3">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={mutation.isPending || checkDuplicatesMutation.isPending}
            data-testid="button-submit"
          >
            {mutation.isPending || checkDuplicatesMutation.isPending ? "Saving..." : contact ? "Update Contact" : "Create Contact"}
          </Button>
        </div>
      </form>

      {pendingContactData && (
        <DuplicateResolutionDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          duplicates={duplicates}
          newContact={{ ...pendingContactData, firstName: pendingContactData.firstName || "", lastName: pendingContactData.lastName || "" }}
          onAddAnyway={handleAddAnyway}
          onOverride={handleOverride}
          onCancel={handleCancel}
        />
      )}
    </Form>
  );
}
