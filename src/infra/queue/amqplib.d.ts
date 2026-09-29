/**
 * Minimal ambient type declarations for amqplib (subset used by this project).
 * amqplib 0.10.x ships no bundled types; declaring only what we use avoids
 * adding @types/amqplib to the dependency list (ponytail: keep deps minimal).
 */

declare module 'amqplib' {
  export interface Connection {
    createChannel(): Promise<Channel>;
    close(): Promise<void>;
    on(event: 'error' | 'close', listener: (error?: Error) => void): void;
  }

  export interface Message {
    content: Buffer;
    fields: Record<string, unknown>;
    properties: Record<string, unknown>;
  }

  export interface ConsumeOptions {
    noAck?: boolean;
    exclusive?: boolean;
    consumerTag?: string;
  }

  export interface PublishOptions {
    persistent?: boolean;
    contentType?: string;
    expiration?: string;
    messageId?: string;
  }

  export interface AssertQueueOptions {
    durable?: boolean;
    arguments?: Record<string, unknown>;
  }

  export interface Channel {
    assertExchange(
      exchange: string,
      type: string,
      options?: { durable?: boolean },
    ): Promise<unknown>;
    assertQueue(queue: string, options?: AssertQueueOptions): Promise<{ queue: string }>;
    bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
    publish(
      exchange: string,
      routingKey: string,
      content: Buffer,
      options?: PublishOptions,
    ): boolean;
    sendToQueue(queue: string, content: Buffer, options?: PublishOptions): boolean;
    consume(
      queue: string,
      onMessage: (message: Message | null) => void,
      options?: ConsumeOptions,
    ): Promise<{ consumerTag: string }>;
    ack(message: Message): void;
    nack(message: Message, allUpTo?: boolean, requeue?: boolean): void;
    prefetch(count: number): Promise<unknown>;
    close(): Promise<void>;
    on(event: 'error' | 'close', listener: (error?: Error) => void): void;
  }

  export function connect(url: string): Promise<Connection>;
}
