export {
  SUPPLIER_ENVIRONMENTS,
  type SupplierEnvironment,
  isSupplierEnvironment,
  type SupplierAccountCredentials,
  type AdapterCallContext,
  type RoomOccupancy,
  type HotelSearchTarget,
  type HotelSearchQuery,
  BOARD_BASES,
  type BoardBasis,
  isBoardBasis,
  type HotelOffer,
  type HotelGuest,
  type HotelBookingHolder,
  type HotelRoomGuests,
  type HotelBookRequest,
  SUPPLIER_BOOKING_STATUSES,
  type SupplierBookingStatus,
  type HotelBookingRecord,
  type HotelSupplierAdapter,
  type FlightSupplierAdapter,
  type GroundSupplierAdapter,
  type SupplierAdapter,
} from "./contracts";

export {
  TRANSPORT_METHODS,
  type TransportMethod,
  type TransportRequest,
  type TransportResponse,
  type Transport,
  type TransportHooks,
  UndiciTransport,
  type RetryPolicy,
  DEFAULT_RETRY_POLICY,
  type CircuitBreakerOptions,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  type CircuitBreakerState,
  CircuitBreaker,
  type SupplierHttpClientOptions,
  createSupplierHttpClient,
} from "./transport";

export {
  type ContentCountry,
  type ContentCity,
  type ContentProperty,
  type HotelContentAdapter,
} from "./content";

export { type FetchFn, createFetchTransport } from "./fetch-transport";

export {
  type JsonCodecOptions,
  formatZodIssues,
  serializeJson,
  parseJsonWith,
} from "./codecs/json";

export {
  type XmlCodecOptions,
  buildXml,
  parseXmlWith,
  type SoapVersion,
  SOAP_ENVELOPE_NS,
  type SoapEnvelopeInput,
  buildSoapEnvelope,
  type SoapFault,
  extractSoapFault,
  defaultSoapFaultKind,
  type ParseSoapOptions,
  parseSoapEnvelope,
} from "./codecs/xml";
