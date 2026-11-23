import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Contact, InsertContact } from "@shared/schema";
import { parseLeadList, parseLeadType } from "@shared/leadTypes";
import { BulkDuplicateResolutionDialog } from "./bulk-duplicate-resolution-dialog";

interface ImportResult {
  total: number;
  successful: number;
  failed: number;
  contacts: Contact[];
  errors: Array<{ row: number; errors?: string; error?: string; data: any }>;
}

interface BulkDuplicateMatch {
  row: number;
  contact: InsertContact;
  duplicates: Contact[];
}

interface ContactImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ContactImport({ open, onOpenChange }: ContactImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsedContacts, setParsedContacts] = useState<InsertContact[]>([]);
  const [duplicateMatches, setDuplicateMatches] = useState<BulkDuplicateMatch[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (contacts: any[]) => {
      const res = await apiRequest("POST", "/api/contacts/import", { contacts });
      return await res.json() as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (data.successful > 0) {
        toast({
          title: "Import completed",
          description: `Successfully imported ${data.successful} of ${data.total} contacts.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import contacts",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setResult(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const parseAndImport = async () => {
    if (!file) return;

    setImporting(true);
    setProgress(10);

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      let parsedData: any[] = [];

      if (fileExtension === 'csv') {
        // Parse CSV
        await new Promise<void>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              parsedData = results.data;
              resolve();
            },
            error: (error) => {
              reject(new Error(`Failed to parse CSV file: ${error.message}`));
            },
          });
        });
      } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Parse Excel
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        parsedData = XLSX.utils.sheet_to_json(firstSheet);
      } else {
        throw new Error('Unsupported file format. Please upload a CSV or Excel file.');
      }

      setProgress(30);

      const contacts = parsedData.map((row: any) => {
        // Read explicit city/state/zip columns first
        const rawCity    = (row.city    || row.City    || row["City"]             || "").trim() || null;
        const rawState   = (row.state   || row.State   || row["State"]            || "").trim() || null;
        const rawZip     = (row.zipCode || row.zip     || row.Zip || row.ZipCode  || row["Zip Code"] || row["zip_code"] || "").trim() || null;
        const rawAddress = (row.address || row.Address || row["Street Address"]   || "").trim() || null;

        // If a full address was placed in the address column without separate city/state/zip,
        // try to parse it out so each field lands in the right place.
        let street = rawAddress;
        let city   = rawCity;
        let state  = rawState;
        let zip    = rawZip;

        if (rawAddress && (!rawCity || !rawState)) {
          // Detect if the address column contains a full address (has a comma + 2-letter state)
          const looksFullAddress = /,\s*[A-Za-z]{2}[\s,]/.test(rawAddress);
          if (looksFullAddress) {
            // Remove trailing ", USA" / ", United States"
            const cleaned = rawAddress.replace(/,?\s*(USA|United States)\s*$/i, "").trim();

            // "STREET, CITY, ST 00000"
            const m1 = cleaned.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)\s*$/);
            if (m1) {
              street = m1[1].trim() || null;
              city   = city   || m1[2].trim() || null;
              state  = state  || m1[3].toUpperCase();
              zip    = zip    || m1[4].trim();
            } else {
              // "STREET, CITY ST 00000"
              const m2 = cleaned.match(/^(.+?),\s*(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
              if (m2) {
                street = m2[1].trim() || null;
                city   = city   || m2[2].trim() || null;
                state  = state  || m2[3].toUpperCase();
                zip    = zip    || m2[4].trim();
              } else {
                // "STREET, CITY, ST"
                const m3 = cleaned.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s*$/);
                if (m3) {
                  street = m3[1].trim() || null;
                  city   = city   || m3[2].trim() || null;
                  state  = state  || m3[3].toUpperCase();
                }
              }
            }
          }
        }

        return {
          firstName: (row.firstName || row.first_name || row.FirstName || "").trim(),
          lastName: (row.lastName || row.last_name || row.LastName || "").trim(),
          email: (row.email || row.Email || "").trim() || null,
          phone: (row.phone || row.Phone || "").trim() || null,
          company: (row.company || row.Company || "").trim() || null,
          jobTitle: (row.jobTitle || row.job_title || row.JobTitle || "").trim() || null,
          address: street,
          city,
          state,
          zipCode: zip,
          leadList: parseLeadList(row.List || row.list || row.leadList || row.lead_list),
          leadType: parseLeadType(row["Lead type"] || row["Lead Type"] || row.leadType || row.lead_type),
          hasWebsite: (row["Has Web Site"] || row.hasWebsite || row.has_website || "").trim() || null,
          websiteUrl: (row["Web Site Address"] || row.websiteUrl || row.website_url || "").trim() || null,
          contactRequestFormUrl: (row["Contact Request Form URL"] || row.contactRequestFormUrl || row.contact_request_form_url || "").trim() || null,
          leadSource: (row.source || row.leadSource || row.lead_source || "").trim() || null,
          notes: (row.notes || row.Notes || "").trim() || null,
          status: (row.status || row.Status || "active").trim() || "active",
        };
      });

      setParsedContacts(contacts);
      setProgress(50);

      // Check for duplicates
      const duplicateResponse = await apiRequest("POST", "/api/contacts/check-bulk-duplicates", { contacts });
      const duplicateData: any = await duplicateResponse.json();
      
      setProgress(70);

      if (duplicateData.duplicates && duplicateData.duplicates.length > 0) {
        setDuplicateMatches(duplicateData.duplicates);
        setShowDuplicateDialog(true);
        setImporting(false);
      } else {
        // No duplicates, proceed with import
        await importMutation.mutateAsync(contacts);
        setProgress(100);
        setImporting(false);
      }
    } catch (error) {
      toast({
        title: "Import error",
        description: error instanceof Error ? error.message : "Failed to import contacts",
        variant: "destructive",
      });
      setProgress(0);
      setImporting(false);
    }
  };

  const handleDuplicateResolution = async (resolutions: Array<{ row: number; action: 'skip' | 'add' | 'override'; overrideId?: string }>) => {
    setImporting(true);
    setProgress(75);

    try {
      const contactsToImport = [];
      const overrideActions = [];

      for (const resolution of resolutions) {
        if (resolution.action === 'add') {
          const contact = parsedContacts[resolution.row - 1];
          contactsToImport.push(contact);
        } else if (resolution.action === 'override' && resolution.overrideId) {
          const contact = parsedContacts[resolution.row - 1];
          overrideActions.push({ id: resolution.overrideId, contact });
        }
      }

      // Import new contacts
      if (contactsToImport.length > 0) {
        await importMutation.mutateAsync(contactsToImport);
      }

      // Override existing contacts
      for (const override of overrideActions) {
        await apiRequest("PUT", `/api/contacts/${override.id}`, override.contact);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });

      toast({
        title: "Import completed",
        description: `Successfully processed ${contactsToImport.length + overrideActions.length} contacts.`,
      });

      setProgress(100);
      setResult({
        total: parsedContacts.length,
        successful: contactsToImport.length + overrideActions.length,
        failed: parsedContacts.length - (contactsToImport.length + overrideActions.length),
        contacts: [],
        errors: []
      });
    } catch (error) {
      toast({
        title: "Import error",
        description: error instanceof Error ? error.message : "Failed to import contacts",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setProgress(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-import-contacts">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to bulk import contacts. Include columns: firstName, lastName, email, phone, company, jobTitle, notes, status
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!result && (
            <>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                data-testid="dropzone-import"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  data-testid="input-file"
                />
                
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="h-12 w-12 text-primary" />
                    <p className="font-medium" data-testid="text-filename">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-change-file"
                    >
                      Change File
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-12 w-12 text-muted-foreground" />
                    <p className="text-lg font-medium">Drop file here or click to browse</p>
                    <p className="text-sm text-muted-foreground">
                      CSV or Excel files (max 10MB)
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-browse"
                    >
                      Browse Files
                    </Button>
                  </div>
                )}
              </div>

              {importing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Processing...</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} data-testid="progress-import" />
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={importing}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={parseAndImport}
                  disabled={!file || importing}
                  data-testid="button-import"
                >
                  {importing ? "Importing..." : "Import Contacts"}
                </Button>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-4">
              <Alert className={result.successful > 0 ? "border-green-500" : "border-red-500"}>
                <div className="flex items-start gap-3">
                  {result.successful > 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <div className="flex-1">
                    <h4 className="font-semibold mb-2" data-testid="text-import-summary">
                      Import Summary
                    </h4>
                    <div className="text-sm space-y-1">
                      <p>Total rows: {result.total}</p>
                      <p className="text-green-600">Successful: {result.successful}</p>
                      {result.failed > 0 && (
                        <p className="text-red-600">Failed: {result.failed}</p>
                      )}
                    </div>
                  </div>
                </div>
              </Alert>

              {result.errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Errors ({result.errors.length})
                  </h4>
                  <div className="max-h-48 overflow-y-auto border rounded-lg p-3 space-y-2">
                    {result.errors.map((error, idx) => (
                      <div key={idx} className="text-sm border-l-2 border-red-500 pl-3 py-1" data-testid={`error-row-${error.row}`}>
                        <p className="font-medium">Row {error.row}</p>
                        <p className="text-muted-foreground">{error.errors || error.error}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleClose}
                  data-testid="button-done"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      <BulkDuplicateResolutionDialog
        open={showDuplicateDialog}
        onOpenChange={setShowDuplicateDialog}
        duplicateMatches={duplicateMatches}
        onResolve={handleDuplicateResolution}
      />
    </Dialog>
  );
}
