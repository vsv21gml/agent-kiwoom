import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

@Injectable()
export class KiwoomEventsService {
  private readonly subject = new Subject<MessageEvent>();

  emit(event: MessageEvent) {
    this.subject.next(event);
  }

  stream(): Observable<MessageEvent> {
    return this.subject.asObservable();
  }
}
