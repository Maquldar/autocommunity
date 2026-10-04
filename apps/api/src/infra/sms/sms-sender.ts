export abstract class SmsSender {
  /** Sends a plain-text SMS to an E.164 number. Throws on delivery failure. */
  abstract send(to: string, text: string): Promise<void>;
}
