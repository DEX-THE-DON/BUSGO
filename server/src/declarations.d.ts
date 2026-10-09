declare module 'pg' {
  export class Pool {
    constructor(config?: any);
    connect(): Promise<PoolClient>;
    query(text: string, values?: any[]): Promise<any>;
    end(): Promise<void>;
  }
  export interface PoolClient {
    query(text: string, values?: any[]): Promise<any>;
    release(err?: any): void;
  }
}

declare module 'ws' {
  export interface WebSocket {
    OPEN?: number;
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: any): void;
    close(code?: number, reason?: string): void;
    readyState: number;
  }
  export default class WebSocketClient implements WebSocket {
    constructor(address: string, protocols?: any);
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: any): void;
    close(code?: number, reason?: string): void;
    readyState: number;
  }
}

declare module 'jsonwebtoken' {
  export function sign(payload: any, secretOrPrivateKey: any, options?: any): string;
  export function verify(token: string, secretOrPublicKey: any, options?: any): any;
  export function decode(token: string, options?: any): any;
}
