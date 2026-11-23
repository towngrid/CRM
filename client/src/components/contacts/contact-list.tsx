import React, { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Mail, Phone, Users, Building, MapPin, Globe, User, Briefcase, FileText, Archive, ArchiveRestore, ChevronUp, ChevronDown, ChevronsUpDown, Trash2, Plus } from "lucide-react";
import type { Contact, Deal, User as UserType } from "@shared/schema";
import { getContactDisplay } from "@/lib/contact-display";
import { contactDeletionLabel } from "@/lib/contact-deletion";
import { leadListLabel, leadTypeLabel } from "@shared/leadTypes";
import { stageLabel, stagePillClass } from "@shared/dealStages";

interface ContactListProps {
  contacts: Contact[];
  deals?: Deal[];
  isLoading: boolean;
  isAdmin?: boolean;
  adminUsers?: UserType[];
  showArchived?: boolean;
  sortColumn: "name" | "company" | "lastContact" | null;
  sortDir: "asc" | "desc";
  onSortChange: (col: "name" | "company" | "lastContact") => void;
  onEdit: (contact: Contact) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onStatusChange: (contactId: string, newStatus: string) => void;
  onAssign?: (contactId: string, newUserId: string) => void;
  selectedContactIds: Set<string>;
  isDeleting: boolean;
  onToggleSelection: (id: string) => void;
  onToggleSelectVisible: () => void;
  onDelete: (contact: Contact) => void;
  onDeleteSelected: () => void;
  onCreateDeal: (contact: Contact) => void;
}

const getStageLabel = (stage: string) => {
  return stageLabel(stage);
};

const getStageColor = (stage: string) => {
  return stagePillClass(stage);
};

function SortIcon({ col, sortColumn, sortDir }: { col: "name" | "company" | "lastContact"; sortColumn: "name" | "company" | "lastContact" | null; sortDir: "asc" | "desc" }) {
  if (sortColumn !== col) return <ChevronsUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground opacity-50" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3.5 w-3.5 ml-1 text-primary" />
    : <ChevronDown className="h-3.5 w-3.5 ml-1 text-primary" />;
}

export default function ContactList({ contacts, deals, isLoading, isAdmin, adminUsers, showArchived, sortColumn, sortDir, onSortChange, onEdit, onArchive, onUnarchive, onStatusChange, onAssign, selectedContactIds, isDeleting, onToggleSelection, onToggleSelectVisible, onDelete, onDeleteSelected, onCreateDeal }: ContactListProps) {
  const [viewContact, setViewContact] = useState<Contact | null>(null);
  const selectedContacts = contacts.filter(contact => selectedContactIds.has(contact.id));
  const canCreateSelectedDeal = selectedContactIds.size === 1 && selectedContacts.length === 1 && !selectedContacts[0].archivedAt;
  const selectionExplanation = selectedContactIds.size === 0
    ? "Select one active contact to create a deal."
    : selectedContactIds.size > 1
      ? "Create Deal is available only when exactly one contact is selected."
      : selectedContacts.length === 0
        ? "The selected contact is not available in the current list. Clear the selection and try again."
      : selectedContacts[0]?.archivedAt
        ? "Archived contacts cannot be used to create a deal. Restore this contact first."
        : "Create a deal for the selected contact.";

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString();
  };

  const getContactDeals = (contactId: string): Deal[] => {
    if (!deals) return [];
    return deals.filter(d => d.contactId === contactId);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center space-x-4">
                <div className="w-10 h-10 bg-muted rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/4"></div>
                  <div className="h-3 bg-muted rounded w-1/3"></div>
                </div>
                <div className="h-8 w-20 bg-muted rounded"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!contacts.length) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            {showArchived ? "No archived contacts" : "No contacts found"}
          </h3>
          <p className="text-muted-foreground">
            {showArchived ? "Archived contacts will appear here." : "Get started by adding your first contact."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const InfoRow = ({ label, value, icon }: { label: string; value: string | number | null | undefined; icon?: ReactNode }) => {
    if (!value && value !== 0) return null;
    return (
      <div className="flex items-start gap-2 py-1.5">
        {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm text-foreground">{String(value)}</p>
        </div>
      </div>
    );
  };

  const SortableHead = ({ col, label }: { col: "name" | "company" | "lastContact"; label: string }) => (
    <TableHead>
      <button
        className="flex items-center font-medium hover:text-primary transition-colors"
        onClick={() => onSortChange(col)}
        data-testid={`sort-${col}`}
      >
        {label}
        <SortIcon col={col} sortColumn={sortColumn} sortDir={sortDir} />
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3" data-testid="contact-selection-toolbar">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={contacts.length > 0 && contacts.every(contact => selectedContactIds.has(contact.id))}
            disabled={isDeleting || contacts.length === 0}
            onChange={onToggleSelectVisible}
            aria-label="Select all visible businesses"
            data-testid="select-visible-contacts"
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Select all {contacts.length} visible
          {selectedContactIds.size > 0 && <span> · {selectedContactIds.size} selected</span>}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canCreateSelectedDeal || isDeleting}
            onClick={() => canCreateSelectedDeal && onCreateDeal(selectedContacts[0])}
            aria-describedby="create-selected-deal-help"
            data-testid="button-create-selected-deal"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Deal
          </Button>
          <span id="create-selected-deal-help" className="sr-only" aria-live="polite">
            {selectionExplanation}
          </span>
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting || selectedContactIds.size === 0}
            onClick={onDeleteSelected}
            data-testid="delete-selected-contacts"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Selected
          </Button>
        </div>
      </div>
      <Card data-testid="contacts-table">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
                <SortableHead col="name" label="Contact" />
                <SortableHead col="company" label="Company" />
                <TableHead>Address</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <SortableHead col="lastContact" label="Last Updated" />
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow 
                  key={contact.id} 
                  className={`hover:bg-muted/50 ${contact.archivedAt ? "opacity-70" : ""}`}
                  data-testid={`contact-row-${contact.id}`}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedContactIds.has(contact.id)}
                      disabled={isDeleting}
                      onChange={() => onToggleSelection(contact.id)}
                      aria-label={`Select ${contactDeletionLabel(contact)}`}
                      data-testid={`select-contact-${contact.id}`}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">
                        {getContactDisplay(contact).initials}
                      </div>
                      <div>
                        <button
                          className="font-medium text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setViewContact(contact)}
                          data-testid={`link-contact-details-${contact.id}`}
                        >
                          {getContactDisplay(contact).name}
                        </button>
                        {contact.jobTitle && (
                          <p className="text-sm text-muted-foreground">{contact.jobTitle}</p>
                        )}
                        {(() => {
                          const openDeals = getContactDeals(contact.id).filter(d => d.stage !== "lost");
                          if (!openDeals.length) return null;
                          const hasWon = openDeals.some(d => d.stage === "won");
                          return (
                            <span className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${hasWon ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"}`}
                              data-testid={`badge-pipeline-${contact.id}`}>
                              <Briefcase className="h-2.5 w-2.5" />
                              {hasWon ? "Won" : "In Pipeline"}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{contact.company || "-"}</TableCell>
                  <TableCell>
                    <div className="max-w-[150px] truncate" title={contact.address || ""}>
                      {contact.address || "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {contact.email ? (
                      <div className="flex items-center space-x-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>{contact.email}</span>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.phone ? (
                      <div className="flex items-center space-x-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{contact.phone}</span>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>{formatDate(contact.lastContactDate)}</TableCell>
                  <TableCell>
                    {contact.archivedAt ? (
                      <Badge variant="outline" className="text-muted-foreground">Archived</Badge>
                    ) : (
                      <Select 
                        value={contact.status} 
                        onValueChange={(value) => onStatusChange(contact.id, value)}
                      >
                        <SelectTrigger 
                          className="w-[110px]" 
                          data-testid={`status-select-${contact.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="pipeline">Pipeline</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end space-x-2">
                      {!contact.archivedAt && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCreateDeal(contact)}
                            aria-label={`Create deal for ${getContactDisplay(contact).name}`}
                            data-testid={`button-create-deal-${contact.id}`}
                          >
                            <Briefcase className="h-4 w-4 sm:mr-1.5" />
                            <span className="hidden sm:inline">Create Deal</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(contact)}
                            aria-label={`Edit ${getContactDisplay(contact).name}`}
                            data-testid={`edit-contact-${contact.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {contact.archivedAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onUnarchive(contact.id)}
                          className="text-green-600 hover:text-green-700"
                          title="Restore contact"
                          data-testid={`unarchive-contact-${contact.id}`}
                        >
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onArchive(contact.id)}
                          className="text-muted-foreground hover:text-orange-600"
                          title="Archive contact"
                          data-testid={`archive-contact-${contact.id}`}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(contact)}
                        disabled={isDeleting}
                        className="text-destructive hover:text-destructive"
                        title="Delete business permanently"
                        aria-label={`Delete ${contactDeletionLabel(contact)} permanently`}
                        data-testid={`delete-contact-${contact.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-1">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!viewContact} onOpenChange={(open) => { if (!open) setViewContact(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="contact-details-dialog">
          {viewContact && (() => {
            const contactDeals = getContactDeals(viewContact.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">
                      {getContactDisplay(viewContact).initials}
                    </div>
                    {getContactDisplay(viewContact).name}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      Pipeline Status
                    </h4>
                    {contactDeals.length > 0 ? (
                      <div className="space-y-2">
                        {contactDeals.map((deal) => (
                          <div key={deal.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30" data-testid={`contact-deal-${deal.id}`}>
                            <div>
                              <p className="font-medium text-sm">{deal.title}</p>
                              {deal.value && (
                                <p className="text-xs text-muted-foreground">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(deal.value))}
                                </p>
                              )}
                            </div>
                            <Badge className={`${getStageColor(deal.stage)} border-0`} data-testid={`contact-deal-stage-${deal.id}`}>
                              {getStageLabel(deal.stage)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic p-3 border border-border rounded-lg bg-muted/30">No deals in pipeline</p>
                    )}
                  </div>

                  {isAdmin && adminUsers && onAssign && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Assigned Salesperson
                      </h4>
                      <div className="p-3 border border-border rounded-lg bg-muted/30">
                        <Select
                          value={viewContact.userId}
                          onValueChange={(value) => {
                            onAssign(viewContact.id, value);
                            setViewContact({ ...viewContact, userId: value });
                          }}
                        >
                          <SelectTrigger className="w-full" data-testid="select-assign-contact">
                            <SelectValue placeholder="Select salesperson" />
                          </SelectTrigger>
                          <SelectContent>
                            {adminUsers.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email || "Unknown"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Contact Information
                      </h4>
                      <div className="flex items-start gap-2 py-1.5">
                        <span className="text-muted-foreground mt-0.5 shrink-0"><Mail className="h-3.5 w-3.5" /></span>
                        <div>
                          <p className="text-xs text-muted-foreground">Email</p>
                          {viewContact.email
                            ? <a href={`mailto:${viewContact.email}`} className="text-sm text-blue-600 hover:underline">{viewContact.email}</a>
                            : <p className="text-sm text-muted-foreground italic">Not provided</p>
                          }
                        </div>
                      </div>
                      <InfoRow label="Phone" value={viewContact.phone} icon={<Phone className="h-3.5 w-3.5" />} />
                      <InfoRow label="Cell Phone" value={viewContact.phoneCell} icon={<Phone className="h-3.5 w-3.5" />} />
                      <InfoRow label="Work Phone" value={viewContact.phoneWork} icon={<Phone className="h-3.5 w-3.5" />} />
                      <InfoRow label="Other Phone" value={viewContact.phoneOther} icon={<Phone className="h-3.5 w-3.5" />} />
                      <InfoRow label="Address" value={viewContact.address} icon={<MapPin className="h-3.5 w-3.5" />} />
                      <InfoRow label="Job Title" value={viewContact.jobTitle} />
                      <InfoRow label="Status" value={viewContact.status} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Building className="h-4 w-4" />
                        Business Information
                      </h4>
                      <InfoRow label="Company" value={viewContact.company} icon={<Building className="h-3.5 w-3.5" />} />
                      <InfoRow label="List" value={viewContact.leadList ? leadListLabel(viewContact.leadList) : null} />
                      <InfoRow label="Lead type" value={viewContact.leadType ? leadTypeLabel(viewContact.leadType) : null} />
                      <InfoRow label="Has Website" value={viewContact.hasWebsite} />
                      <InfoRow label="Website URL" value={viewContact.websiteUrl} icon={<Globe className="h-3.5 w-3.5" />} />
                      <InfoRow label="Number of Employees" value={viewContact.numberOfEmployees} />
                      <InfoRow label="Number of Locations" value={viewContact.numberOfLocations} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Social & Web
                      </h4>
                      <InfoRow label="Facebook" value={viewContact.facebookUrl} />
                      <InfoRow label="Instagram" value={viewContact.instagramHandle} />
                      <InfoRow label="Contact Form URL" value={viewContact.contactRequestFormUrl} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Additional Details
                      </h4>
                      <InfoRow label="Lead Source" value={viewContact.leadSource} />
                      <InfoRow label="Interest Level" value={viewContact.interestLevel} />
                      <InfoRow label="Sequence Track" value={viewContact.sequenceTrack} />
                      <InfoRow label="Secondary Contact" value={viewContact.secondaryFirstName && viewContact.secondaryLastName ? `${viewContact.secondaryFirstName} ${viewContact.secondaryLastName}` : null} />
                      <InfoRow label="Last Contact Date" value={viewContact.lastContactDate ? formatDate(viewContact.lastContactDate) : null} />
                    </div>
                  </div>

                  {(viewContact.painPoints || viewContact.notes) && (
                    <div>
                      {viewContact.painPoints && (
                        <div className="mb-3">
                          <h4 className="text-sm font-semibold text-foreground mb-1">Pain Points</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded-lg border border-border">{viewContact.painPoints}</p>
                        </div>
                      )}
                      {viewContact.notes && (
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-1">Notes</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded-lg border border-border">{viewContact.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
