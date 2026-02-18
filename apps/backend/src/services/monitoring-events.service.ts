import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { map } from "rxjs/operators";

type MonitoringEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

@Injectable()
export class MonitoringEventsService {
  private readonly subject = new Subject<MonitoringEvent>();

  emit(type: string, payload?: Record<string, unknown>) {
    this.subject.next({ type, payload });
  }

  stream(): Observable<MessageEvent> {
    return this.subject.asObservable().pipe(
      map((event) => ({
        type: event.type,
        data: event.payload ?? {},
      })),
    );
  }
}
