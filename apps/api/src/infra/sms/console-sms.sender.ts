import { Logger } from '@nestjs/common';
import { maskPhone } from '@autoc/shared';
import { SmsSender } from './sms-sender';

/** Development sender: writes the message to the server log instead of sending it. */
export class ConsoleSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  async send(to: string, text: string): Promise<void> {
    this.logger.log(`[console SMS] to ${maskPhone(to)}: ${text}`);
  }
}
