import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import ContactList from "@/components/contacts/contact-list";
import ContactForm from "@/components/contacts/contact-form";
import ContactImport from "@/components/contacts/contact-import";
import DealForm from "@/components/deals/deal-form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_LISTS, leadTypesForList } from "@shared/leadTypes";
import { useIndustries } from "@/hooks/useIndustries";
import { IndustryFilterSelect, matchesIndustry } from "@/components/industry-filter";
import { Download, Users, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Deal, User } from "@shared/schema";
import { contactDeletionLabel, deleteContactBatch } from "@/lib/contact-deletion";

export default function Contacts() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dealContact, setDealContact] = useState<Contact | undefined>();
  const [isCreatingDeal, setIsCreatingDeal] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const [leadTypeFilter, setLeadTypeFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const { industries } = useIndustries();
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<Contact[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sortColumn, setSortColumn] = useState<"name" | "company" | "lastContact" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const initialFilterUserId = isAdmin ? new URLSearchParams(window.location.search).get("filterUserId") || "" : "";
  const [filterUserId, setFilterUserId] = useState(initialFilterUserId);
  const filterChangeVersion = useRef(0);

  // Auto-open edit dialog when navigated here with ?edit=contactId
  const editContactId = new URLSearchParams(window.location.search).get("edit") || "";

  const handleFilterChange = (value: string) => {
    setFilterUserId(value === "all" ? "" : value);
  };

  useEffect(() => {
    filterChangeVersion.current += 1;
    setSelectedContactIds(new Set());
    setDeleteTargets([]);
    setIsDeleteDialogOpen(false);
  }, [searchQuery, leadTypeFilter, filterUserId, showArchived]);

  const { data: adminUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", searchQuery, filterUserId, showArchived],
    refetchOnMount: "always",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (filterUserId) params.set("filterUserId", filterUserId);
      if (showArchived) params.set("showArchived", "true");
      const queryString = params.toString();
      const url = queryString ? `/api/contacts?${queryString}` : "/api/contacts";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch contacts");
      return response.json();
    },
  });

  // Open edit dialog automatically when ?edit= param is present and contacts have loaded
  useEffect(() => {
    if (!editContactId || !contacts) return;
    const contact = contacts.find(c => c.id === editContactId);
    if (contact) {
      setSelectedContact(contact);
      setIsFormOpen(true);
      // Clean up the URL param without causing a navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState({}, "", url.toString());
    }
  }, [editContactId, contacts]);

  const { data: deals } = useQuery<Deal[]>({
    queryKey: ["/api/deals", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/deals?${queryString}` : "/api/deals";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch deals");
      return response.json();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/contacts/${id}/archive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact archived", description: "Contact moved to archive. You can restore it anytime." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive contact", variant: "destructive" });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/contacts/${id}/unarchive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact restored", description: "Contact has been moved back to your active contacts." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to restore contact", variant: "destructive" });
    },
  });

  const statusChangeMutation = useMutation({
    mutationFn: async ({ contactId, status }: { contactId: string; status: string }) => {
      return apiRequest("PATCH", `/api/contacts/${contactId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Status updated", description: "Contact status has been updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to update contact status", variant: "destructive" });
    },
  });

  const handleEdit = (contact: Contact) => {
    setSelectedContact(contact);
    setIsFormOpen(true);
  };

  const handleArchive = (id: string) => {
    if (confirm("Archive this contact? Their deals and history will be kept. You can restore them anytime.")) {
      archiveMutation.mutate(id);
    }
  };

  const handleUnarchive = (id: string) => {
    unarchiveMutation.mutate(id);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedContact(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
  };

  const handleCreateDeal = (contact: Contact) => {
    if (contact.archivedAt) return;
    setDealContact(contact);
    setIsCreatingDeal(false);
  };

  const handleDealCreated = async () => {
    const refreshPrefixes = ["/api/deals", "/api/contacts", "/api/deals/email-summaries", "/api/dashboard"];
    await queryClient.invalidateQueries({
      predicate: query => {
        const key = query.queryKey[0];
        return typeof key === "string" && refreshPrefixes.some(prefix =>
          key === prefix || key.startsWith(`${prefix}/`) || key.startsWith(`${prefix}?`));
      },
    });
    setSelectedContactIds(new Set());
    setDealContact(undefined);
    setIsCreatingDeal(false);
  };

  const handleExport = () => {
    window.open('/api/export/contacts', '_blank');
  };

  const openDeleteConfirmation = (targets: Contact[]) => {
    if (isDeleting || !targets.length) return;
    setDeleteTargets(targets);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteContacts = async () => {
    if (isDeleting || !deleteTargets.length) return;
    const targets = [...deleteTargets];
    const filterVersionAtStart = filterChangeVersion.current;
    const removedIds = new Set<string>();
    const failures: Array<{ contact: Contact; status: string }> = [];
    setIsDeleting(true);
    try {
      const outcome = await deleteContactBatch(targets.map(contact => contact.id),
        id => apiRequest("DELETE", `/api/contacts/${encodeURIComponent(id)}`));
      outcome.removedIds.forEach(id => removedIds.add(id));
      outcome.failures.forEach(failure => {
        const contact = targets.find(target => target.id === failure.id);
        if (contact) failures.push({ contact, status: failure.status });
      });

      if (removedIds.size) {
        const cachePrefixes = [
          "/api/contacts", "/api/deals", "/api/dashboard", "/api/activities",
          "/api/tasks", "/api/inbox", "/api/email-sequence-logs", "/api/salon-enrichment",
          "/api/salon-form-outreach", "/api/salon-search-report", "/api/salon-owner-names/rows",
        ];
        await queryClient.invalidateQueries({ predicate: query => {
          const path = query.queryKey[0];
          return typeof path === "string" && cachePrefixes.some(prefix =>
            path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
        } });
      }
      if (filterChangeVersion.current === filterVersionAtStart) {
        setSelectedContactIds(new Set(failures.map(({ contact }) => contact.id)));
      }
      setIsDeleteDialogOpen(false);
      setDeleteTargets([]);

      if (failures.length) {
        const linkedCount = failures.filter(({ status }) => status === "409").length;
        const description = [
          removedIds.size ? `${removedIds.size} ${removedIds.size === 1 ? "record was" : "records were"} permanently removed.` : "",
          `${failures.length} ${failures.length === 1 ? "record could not" : "records could not"} be removed${filterChangeVersion.current === filterVersionAtStart ? " and remain selected" : ""}.`,
          linkedCount ? `${linkedCount} ${linkedCount === 1 ? "record is" : "records are"} linked to deals or history; archive ${linkedCount === 1 ? "it" : "them"} instead.` : "",
        ].filter(Boolean).join(" ");
        toast({ title: "Some businesses were not removed", description, variant: "destructive" });
      } else {
        toast({
          title: targets.length === 1 ? "Business removed" : "Businesses removed",
          description: `${targets.length} ${targets.length === 1 ? "business record was" : "business records were"} permanently removed.`,
        });
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const assignMutation = useMutation({
    mutationFn: async ({ contactId, userId: newUserId }: { contactId: string; userId: string }) => {
      return apiRequest("PATCH", `/api/contacts/${contactId}/assign`, { userId: newUserId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact reassigned", description: "Contact has been assigned to the selected salesperson." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to reassign contact", variant: "destructive" });
    },
  });

  const handleStatusChange = (contactId: string, newStatus: string) => {
    statusChangeMutation.mutate({ contactId, status: newStatus });
  };

  const handleAssign = (contactId: string, newUserId: string) => {
    assignMutation.mutate({ contactId, userId: newUserId });
  };

  const handleSortChange = (col: "name" | "company" | "lastContact") => {
    if (sortColumn === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  };

  const sortedContacts = useMemo(() => {
    if (!contacts || !Array.isArray(contacts)) return [];
    let list = [...contacts];

    if (leadTypeFilter === "none") {
      list = list.filter(c => !c.leadType);
    } else if (leadTypeFilter.startsWith("list:")) {
      list = list.filter(c => c.leadList === leadTypeFilter.slice(5));
    } else if (leadTypeFilter !== "all") {
      list = list.filter(c => c.leadType === leadTypeFilter);
    }

    list = list.filter(c => matchesIndustry(industryFilter, c.industryGroup, c.industryType));

    if (sortColumn) {
      list.sort((a, b) => {
        let aVal: string | number = "";
        let bVal: string | number = "";

        if (sortColumn === "name") {
          aVal = `${a.firstName} ${a.lastName}`.toLowerCase();
          bVal = `${b.firstName} ${b.lastName}`.toLowerCase();
        } else if (sortColumn === "company") {
          aVal = (a.company || "").toLowerCase();
          bVal = (b.company || "").toLowerCase();
        } else if (sortColumn === "lastContact") {
          aVal = a.lastContactDate ? new Date(a.lastContactDate).getTime() : 0;
          bVal = b.lastContactDate ? new Date(b.lastContactDate).getTime() : 0;
        }

        if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    } else {
      // Default: Active first, then Pipeline, then Inactive
      const statusOrder: Record<string, number> = { active: 0, pipeline: 1, inactive: 2 };
      list.sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 1;
        const bOrder = statusOrder[b.status] ?? 1;
        return aOrder - bOrder;
      });
    }

    return list;
  }, [contacts, sortColumn, sortDir, leadTypeFilter, industryFilter]);

  return (
    <>
      <Header 
        title="Contacts" 
        onSearch={setSearchQuery}
        onAddNew={() => setIsFormOpen(true)}
        onImport={() => setIsImportOpen(true)}
        showImportButton={true}
        addButtonText="Add Contact"
        customActions={
          <div className="flex items-center gap-2">
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setShowArchived(v => !v)}
              data-testid="button-toggle-archived"
            >
              {showArchived ? (
                <><ArchiveRestore className="h-4 w-4 mr-2" />Active Contacts</>
              ) : (
                <><Archive className="h-4 w-4 mr-2" />Archived</>
              )}
            </Button>
            {isAdmin && (
              <>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterUserId || "all"} onValueChange={handleFilterChange}>
                    <SelectTrigger className="w-[200px]" data-testid="select-filter-user">
                      <SelectValue placeholder="All Salespeople" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Salespeople</SelectItem>
                      {adminUsers?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email || "Unknown"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleExport}
                  data-testid="button-export"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </>
            )}
          </div>
        }
      />
      
      <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30" data-testid="contacts-content">
        <p className="mb-4 text-sm text-muted-foreground">Contacts store reviewed business and person details. Find new businesses in Business Search, track sales opportunities in Pipeline, and confirm messages separately in Outreach.</p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium text-muted-foreground">Lead type:</span>
          <Select value={leadTypeFilter} onValueChange={setLeadTypeFilter}>
            <SelectTrigger className="w-72 bg-background" data-testid="filter-lead-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contacts</SelectItem>
              {LEAD_LISTS.map(l => (
                <SelectGroup key={l.value}>
                  <SelectLabel>{l.label} list</SelectLabel>
                  <SelectItem value={`list:${l.value}`}>All {l.label}</SelectItem>
                  {leadTypesForList(l.value).map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
              <SelectItem value="none">No lead type yet</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm font-medium text-muted-foreground ml-2">Industry:</span>
          <IndustryFilterSelect value={industryFilter} onChange={setIndustryFilter} industries={industries} />
          {(leadTypeFilter !== "all" || industryFilter !== "all") && (
            <span className="text-xs text-muted-foreground ml-1">
              ({sortedContacts.length} contact{sortedContacts.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>
        <ContactList
          contacts={sortedContacts}
          deals={deals}
          isLoading={isLoading}
          isAdmin={isAdmin}
          adminUsers={adminUsers}
          showArchived={showArchived}
          sortColumn={sortColumn}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onEdit={handleEdit}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
          selectedContactIds={selectedContactIds}
          isDeleting={isDeleting}
          onToggleSelection={(id) => setSelectedContactIds(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          onToggleSelectVisible={() => setSelectedContactIds(current => {
            const visibleIds = sortedContacts.map(contact => contact.id);
            const allSelected = visibleIds.length > 0 && visibleIds.every(id => current.has(id));
            const next = new Set(current);
            visibleIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
            return next;
          })}
          onDelete={(contact) => openDeleteConfirmation([contact])}
          onDeleteSelected={() => openDeleteConfirmation(
            sortedContacts.filter(contact => selectedContactIds.has(contact.id))
          )}
          onCreateDeal={handleCreateDeal}
        />
      </main>

      <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        if (!isDeleting) setIsDeleteDialogOpen(open);
      }}>
        <DialogContent className="max-w-lg" data-testid="delete-business-confirmation">
          <DialogHeader>
            <DialogTitle>Delete {deleteTargets.length} {deleteTargets.length === 1 ? "business" : "businesses"} permanently?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected contact records. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3 text-sm" aria-label="Businesses selected for deletion">
            {deleteTargets.map(contact => {
              const fallbackName = contactDeletionLabel(contact);
              return (
                <li key={contact.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{fallbackName}</span>
                  {contact.phone && <span className="text-muted-foreground">{contact.phone}</span>}
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">What happens when you delete</p>
            <p>Permanently removes these contact records. Queued email records are removed; emails already sent or in flight cannot be recalled.</p>
            <p>Existing tasks, messages, and activity history are preserved but unlinked. Businesses linked to deals cannot be deleted.</p>
            <p>To keep a business and its history, cancel and use Archive instead.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={isDeleting} onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={isDeleting || !deleteTargets.length} onClick={handleDeleteContacts} data-testid="confirm-delete-businesses">
              <Trash2 className="mr-2 h-4 w-4" />
              {isDeleting ? "Deleting…" : `Delete ${deleteTargets.length} ${deleteTargets.length === 1 ? "business" : "businesses"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedContact ? "Edit Contact" : "Add New Contact"}
            </DialogTitle>
          </DialogHeader>
          <ContactForm
            contact={selectedContact}
            onSuccess={handleFormSuccess}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!dealContact}
        onOpenChange={(open) => {
          if (open) return;
          if (!isCreatingDeal) {
            setDealContact(undefined);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="contact-create-deal-dialog">
          <DialogHeader>
            <DialogTitle>Create Deal</DialogTitle>
            <DialogDescription>
              Create a pipeline opportunity linked to {dealContact?.company || (dealContact ? `${dealContact.firstName} ${dealContact.lastName}`.trim() : "this contact")}.
            </DialogDescription>
          </DialogHeader>
          {dealContact && (
            <DealForm
              key={dealContact.id}
              initialContact={dealContact}
              onSuccess={handleDealCreated}
              onCancel={() => {
                if (!isCreatingDeal) setDealContact(undefined);
              }}
              onPendingChange={setIsCreatingDeal}
            />
          )}
        </DialogContent>
      </Dialog>

      <ContactImport 
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </>
  );
}
