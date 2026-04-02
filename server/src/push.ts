import Expo, { type ExpoPushMessage } from "expo-server-sdk";
import type {
  PushDeliveryStatus,
  PushNotificationInput,
  PushNotificationOutcome,
  PushReceiptOutcome,
  PushProvider,
} from "./push-provider";

const RETRYABLE_EXPO_ERRORS = new Set([
  "MessageRateExceeded",
  "TooManyRequests",
  "ServiceUnavailable",
  "InternalServerError",
]);

const INVALID_EXPO_ERRORS = new Set(["DeviceNotRegistered"]);

function classifyExpoError(
  errorCode: string | null | undefined
): {
  status: PushDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (!errorCode) {
    return {
      status: "failed",
      errorCode: null,
      errorMessage: null,
    };
  }

  if (INVALID_EXPO_ERRORS.has(errorCode)) {
    return {
      status: "invalid",
      errorCode,
      errorMessage: errorCode,
    };
  }

  if (RETRYABLE_EXPO_ERRORS.has(errorCode)) {
    return {
      status: "retryable",
      errorCode,
      errorMessage: errorCode,
    };
  }

  return {
    status: "failed",
    errorCode,
    errorMessage: errorCode,
  };
}

function buildFailedOutcome(
  message: PushNotificationInput,
  status: PushDeliveryStatus,
  errorCode: string | null,
  errorMessage: string | null
): PushNotificationOutcome {
  return {
    installationId: message.installationId,
    pushToken: message.pushToken,
    status,
    providerTicketId: null,
    providerReceiptId: null,
    errorCode,
    errorMessage,
  };
}

export class ExpoPushProvider implements PushProvider {
  readonly name = "expo";

  constructor(private readonly expo = new Expo()) {}

  async send(
    messages: PushNotificationInput[]
  ): Promise<PushNotificationOutcome[]> {
    if (messages.length === 0) {
      return [];
    }

    const outcomes: Array<PushNotificationOutcome | undefined> = new Array(
      messages.length
    );

    const validMessages: Array<{
      index: number;
      message: PushNotificationInput;
    }> = [];
    const expoMessages: ExpoPushMessage[] = [];

    messages.forEach((message, index) => {
      if (!Expo.isExpoPushToken(message.pushToken)) {
        outcomes[index] = buildFailedOutcome(
          message,
          "invalid",
          "InvalidExpoPushToken",
          "Token de Expo inválido"
        );
        return;
      }

      validMessages.push({ index, message });
      expoMessages.push({
        to: message.pushToken,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: "default",
        priority: "high",
      });
    });

    const chunks = this.expo.chunkPushNotifications(expoMessages);
    let cursor = 0;

    for (const chunk of chunks) {
      const chunkMessages = validMessages.slice(cursor, cursor + chunk.length);
      cursor += chunk.length;

      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);

        tickets.forEach((ticket, index) => {
          const original = chunkMessages[index];
          if (!original) return;

          if (ticket.status === "ok") {
            outcomes[original.index] = {
              installationId: original.message.installationId,
              pushToken: original.message.pushToken,
              status: "sent",
              providerTicketId: ticket.id ?? null,
              providerReceiptId: null,
              errorCode: null,
              errorMessage: null,
            };
            return;
          }

          const classification = classifyExpoError(ticket.details?.error ?? null);
          outcomes[original.index] = {
            installationId: original.message.installationId,
            pushToken: original.message.pushToken,
            status: classification.status,
            providerTicketId: null,
            providerReceiptId: null,
            errorCode: classification.errorCode,
            errorMessage: ticket.message ?? classification.errorMessage,
          };
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Error enviando chunk Expo";

        chunkMessages.forEach((chunkMessage) => {
          outcomes[chunkMessage.index] = buildFailedOutcome(
            chunkMessage.message,
            "retryable",
            "ExpoChunkError",
            errorMessage
          );
        });
      }
    }

    return outcomes.map((outcome, index) => {
      if (outcome) return outcome;

      const message = messages[index];
      return buildFailedOutcome(
        message,
        "failed",
        "ExpoUnknownOutcome",
        "No se obtuvo resultado para el envío"
      );
    });
  }

  async fetchReceipts(ticketIds: string[]): Promise<PushReceiptOutcome[]> {
    if (ticketIds.length === 0) {
      return [];
    }

    const outcomes: PushReceiptOutcome[] = [];
    const chunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);

    for (const chunk of chunks) {
      try {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);

        for (const ticketId of chunk) {
          const receipt = receipts[ticketId];
          if (!receipt) {
            continue;
          }

          if (receipt.status === "ok") {
            outcomes.push({
              providerTicketId: ticketId,
              providerReceiptId: ticketId,
              status: "sent",
              errorCode: null,
              errorMessage: null,
            });
            continue;
          }

          const classification = classifyExpoError(receipt.details?.error ?? null);
          outcomes.push({
            providerTicketId: ticketId,
            providerReceiptId: ticketId,
            status: classification.status,
            errorCode: classification.errorCode,
            errorMessage: receipt.message ?? classification.errorMessage,
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Error obteniendo receipts Expo";

        chunk.forEach((ticketId) => {
          outcomes.push({
            providerTicketId: ticketId,
            providerReceiptId: null,
            status: "retryable",
            errorCode: "ExpoReceiptError",
            errorMessage,
          });
        });
      }
    }

    return outcomes;
  }
}

export function createExpoPushProvider(): ExpoPushProvider {
  return new ExpoPushProvider();
}
