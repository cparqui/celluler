export class EventFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventFormatError";
  }
}

export class JournalError extends Error {
  constructor(message, index = null) {
    super(index === null ? message : `Journal event ${index}: ${message}`);
    this.name = "JournalError";
    this.index = index;
  }
}
