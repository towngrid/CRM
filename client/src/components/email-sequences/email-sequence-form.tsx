import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { insertEmailSequenceSchema, type EmailSequence } from "@shared/schema";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Link2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EmailSequenceFormProps {
  sequence?: Partial<EmailSequence>;
  onSuccess: () => void;
  onCancel: () => void;
}

const LINKS: { label: string; html: string; description?: string }[] = [
  { label: "Visit TownGrid", html: '<a href="https://towngrid.net/">Visit TownGrid</a>' },
];

export default function EmailSequenceForm({ sequence, onSuccess, onCancel }: EmailSequenceFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isEdit = !!sequence?.id;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sequenceNumber = sequence?.sequenceNumber || 1;
  const sequenceTrack = sequence?.sequenceTrack || "no_software";

  // Generate time options (12-hour format with half-hour increments)
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const hour24 = Math.floor(i / 2);
    const minutes = i % 2 === 0 ? "00" : "30";
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    const ampm = hour24 < 12 ? "AM" : "PM";
    const value = `${hour24.toString().padStart(2, '0')}:${minutes}`;
    const label = `${hour12}:${minutes} ${ampm}`;
    return { value, label };
  });

  // Generate days options (1-30 days)
  const daysOptions = Array.from({ length: 30 }, (_, i) => i + 1);

  const form = useForm({
    resolver: zodResolver(insertEmailSequenceSchema),
    defaultValues: {
      strategy: sequence?.strategy || "legacy",
      sequenceNumber: sequence?.sequenceNumber || 1,
      sequenceTrack: sequenceTrack,
      subject: sequence?.subject || "",
      body: sequence?.body || `[Contact_Greeting]\n\n\n\nBest regards,\n[Sales_Person]`,
      scheduledDate: sequence?.scheduledDate ? new Date(sequence.scheduledDate).toISOString().split('T')[0] : "",
      scheduledTime: sequence?.scheduledTime || "09:00",
      daysAfterNoReply: sequence?.daysAfterNoReply || (sequenceNumber > 1 ? 3 : null),
      isActive: sequence?.isActive || "true",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertEmailSequenceSchema>) => {
      return await apiRequest("POST", "/api/email-sequences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/email-sequences?track=${sequenceTrack}`] });
      toast({
        title: "Success",
        description: "Email sequence created successfully",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create email sequence",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<z.infer<typeof insertEmailSequenceSchema>>) => {
      return await apiRequest("PATCH", `/api/email-sequences/${sequence?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/email-sequences?track=${sequenceTrack}`] });
      toast({
        title: "Success",
        description: "Email sequence updated successfully",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update email sequence",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof insertEmailSequenceSchema>) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  function insertLink(html: string) {
    const el = textareaRef.current;
    const current = form.getValues("body") || "";
    const pos = el ? el.selectionStart : current.length;
    const newValue = current.slice(0, pos) + html + current.slice(pos);
    form.setValue("body", newValue, { shouldDirty: true });
    if (el) {
      const newPos = pos + html.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newPos, newPos);
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="form-email-sequence">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Email Subject</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="Enter email subject"
                    data-testid="input-subject"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <FormLabel>Email Body</FormLabel>
                  <TooltipProvider delayDuration={200}>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {LINKS.map((link) => (
                        <Tooltip key={link.label}>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => insertLink(link.html)}
                              data-testid={`button-insert-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                              className="h-7 text-xs gap-1.5"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              {link.label}
                              {link.description && <Info className="h-3 w-3 text-muted-foreground" />}
                            </Button>
                          </TooltipTrigger>
                          {link.description && (
                            <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                              {link.description}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      ))}
                    </div>
                  </TooltipProvider>
                </div>
                <FormControl>
                  <Textarea
                    {...field}
                    ref={(el) => {
                      field.ref(el);
                      textareaRef.current = el;
                    }}
                    rows={12}
                    placeholder="Write your email content here..."
                    data-testid="input-body"
                    className="font-mono text-sm"
                  />
                </FormControl>
                <FormDescription>
                  Use [Contact_Greeting] for “Hi first name,” or “Hi business name team,” automatically. [Contact_First_Name], [Sales_Person], [Business_Name], and [City] also work.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {sequenceNumber === 1 ? (
            <>
              <FormField
                control={form.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="date"
                        data-testid="input-scheduled-date"
                      />
                    </FormControl>
                    <FormDescription>
                      When to send this email
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scheduledTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Time</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "09:00"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-scheduled-time">
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {timeOptions.map(time => (
                          <SelectItem key={time.value} value={time.value}>{time.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Time to send (Eastern Time)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <FormField
              control={form.control}
              name="daysAfterNoReply"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Days After No Reply</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(parseInt(value))} 
                    defaultValue={field.value?.toString() || "3"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-days-after-no-reply">
                        <SelectValue placeholder="Select number of days" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {daysOptions.map(days => (
                        <SelectItem key={days} value={days.toString()}>
                          {days} {days === 1 ? 'day' : 'days'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Send this email {sequenceNumber - 1 > 0 ? `after no reply to Sequence ${sequenceNumber - 1}` : ''}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || "true"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-is-active">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Only active sequences will be sent automatically
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            data-testid="button-submit"
          >
            {isPending ? "Saving..." : isEdit ? "Update Sequence" : "Create Sequence"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
