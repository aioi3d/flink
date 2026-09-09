import ExpoModulesCore

internal struct FlinkDocumentRefRecord: Record {
  @Field var fileId: String = ""
  @Field var revision: String = ""
}

internal struct FlinkInputContextRecord: Record {
  @Field var jsRuntimeId: String = ""
  @Field var readerSessionId: String = ""
  @Field var generation: String = ""
}

internal struct FlinkOpenDocumentInputRecord: Record {
  @Field var openRequestId: String = ""
  @Field var document: FlinkDocumentRefRecord = .init()
}

internal struct FlinkNavigateMoveRecord: Record {
  @Field var delta: Int?
  @Field var pageIndex: Int?
}

/// One bridge record represents the discriminated NavigateRequest union.
/// Phase 2 validates the source-specific required and forbidden fields again.
internal struct FlinkNavigateRequestRecord: Record {
  @Field var readerSessionId: String = ""
  @Field var commandId: String = ""
  @Field var source: String = ""
  @Field var move: FlinkNavigateMoveRecord = .init()
  @Field var inputContext: FlinkInputContextRecord?
  @Field var trackingEpoch: String?
  @Field var sampleNativeMs: Double?
}
