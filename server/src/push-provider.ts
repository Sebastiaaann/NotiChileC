export type PushDeliveryStatus = "sent" | "retryable" | "invalid" | "failed";

export interface PushNotificationInput {
  installationId: string;
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushNotificationOutcome {
  installationId: string;
  pushToken: string;
  status: PushDeliveryStatus;
  providerTicketId: string | null;
  providerReceiptId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PushReceiptOutcome {
  providerTicketId: string;
  providerReceiptId: string | null;
  status: PushDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PushProvider {
  readonly name: string;
  send(messages: PushNotificationInput[]): Promise<PushNotificationOutcome[]>;
  fetchReceipts(ticketIds: string[]): Promise<PushReceiptOutcome[]>;
}
