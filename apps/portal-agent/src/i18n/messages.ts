/**
 * Agent Portal message catalogs — Arabic first, English mirror (CLAUDE.md
 * rule 9: every screen ships both from its first commit). One typed shape;
 * a missing key in either catalog is a compile error, not a runtime blank.
 */

import type { Locale } from "@jenova/domain";

export interface Messages {
  readonly common: {
    readonly portalName: string;
    readonly loading: string;
    readonly retry: string;
    readonly cancel: string;
    readonly confirm: string;
    readonly back: string;
    readonly logout: string;
    readonly switchLocale: string;
    readonly switchLocaleShort: string;
    readonly openNavigation: string;
    readonly collapseNavigation: string;
    readonly genericError: string;
    readonly sessionExpired: string;
    readonly notFound: string;
  };
  readonly login: {
    readonly title: string;
    readonly subtitle: string;
    readonly email: string;
    readonly password: string;
    readonly submit: string;
    readonly submitting: string;
    readonly invalidCredentials: string;
  };
  readonly nav: {
    readonly search: string;
    readonly bookings: string;
  };
  readonly search: {
    readonly title: string;
    readonly subtitle: string;
    readonly destination: string;
    readonly destinationPlaceholder: string;
    readonly destinationLoading: string;
    readonly hotelsOptional: string;
    readonly hotelsHint: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nationality: string;
    readonly nationalityHint: string;
    readonly currency: string;
    readonly rooms: string;
    readonly room: string;
    readonly addRoom: string;
    readonly removeRoom: string;
    readonly adults: string;
    readonly children: string;
    readonly childAge: string;
    readonly submit: string;
    readonly searching: string;
    readonly newSearch: string;
    readonly resultsTitle: string;
    readonly topHotelsNote: string;
    readonly budgetExhausted: string;
    readonly streamFailed: string;
    readonly noResults: string;
    readonly streamingLabel: string;
    readonly filters: string;
    readonly filterRefundableOnly: string;
    readonly filterBoard: string;
    readonly filterMaxPrice: string;
    readonly filterAll: string;
    readonly perStay: string;
    readonly refundable: string;
    readonly nonRefundable: string;
    readonly viewOffer: string;
    readonly offersShown: (shown: number, total: number) => string;
  };
  readonly offer: {
    readonly title: string;
    readonly staySummary: string;
    readonly hotel: string;
    readonly roomName: string;
    readonly board: string;
    readonly dates: string;
    readonly nights: (n: number) => string;
    readonly occupancy: string;
    readonly guests: (adults: number, children: number) => string;
    readonly nationality: string;
    readonly supplier: string;
    readonly sellPrice: string;
    readonly cancellationPolicy: string;
    readonly checkTitle: string;
    readonly checkExplainer: string;
    readonly checkButton: string;
    readonly checking: string;
    readonly checkedOk: string;
    readonly checkedOkUntil: string;
    readonly expired: string;
    readonly expiredExplainer: string;
    readonly missing: string;
    readonly missingExplainer: string;
    readonly backToResults: string;
    readonly priceChangedTitle: string;
    readonly priceChangedExplainer: string;
    readonly policyAlsoChanged: string;
    readonly oldPrice: string;
    readonly newPrice: string;
    readonly acceptNewPrice: string;
    readonly declineNewPrice: string;
    readonly soldOut: string;
    readonly checkFailed: string;
  };
  readonly book: {
    readonly title: string;
    readonly holder: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string;
    readonly roomGuests: (room: number) => string;
    readonly guestAdult: (n: number) => string;
    readonly guestChild: (n: number, age: number) => string;
    readonly clientReference: string;
    readonly clientReferenceHint: string;
    readonly submit: string;
    readonly submitting: string;
    readonly mustCheckFirst: string;
    readonly validationRequired: string;
    readonly bookFailed: string;
    readonly conflictReference: string;
  };
  readonly confirmation: {
    readonly title: string;
    readonly pendingTitle: string;
    readonly bookingRef: string;
    readonly supplierRef: string;
    readonly state: string;
    readonly amount: string;
    readonly idempotentReplay: string;
    readonly voucher: string;
    readonly voucherPending: string;
    readonly goToBooking: string;
    readonly goToBookings: string;
  };
  readonly bookings: {
    readonly title: string;
    readonly subtitle: string;
    readonly empty: string;
    readonly loadFailed: string;
    readonly colReference: string;
    readonly colSupplierRef: string;
    readonly colState: string;
    readonly colAmount: string;
    readonly colCreated: string;
    readonly detailTitle: string;
    readonly item: string;
    readonly supplier: string;
    readonly paymentState: string;
    readonly history: string;
    readonly historyEmpty: string;
    readonly policy: string;
    readonly sellOnlyNote: string;
    readonly cancelButton: string;
    readonly cancelNotAllowed: string;
    readonly feePreviewTitle: string;
    readonly feePreviewExplainer: string;
    readonly penaltyNow: string;
    readonly refundNow: string;
    readonly refundUnknown: string;
    readonly asOf: string;
    readonly confirmCancel: string;
    readonly keepBooking: string;
    readonly cancelling: string;
    readonly cancelled: string;
    readonly cancellationPending: string;
    readonly cancellationPendingExplainer: string;
    readonly cancelFailed: string;
  };
  readonly states: {
    readonly quoted: string;
    readonly reserved: string;
    readonly pending_confirmation: string;
    readonly confirmed: string;
    readonly issued: string;
    readonly amendment_pending: string;
    readonly completed: string;
    readonly cancelled: string;
    readonly failed: string;
    readonly escalated: string;
    readonly cancellation_in_progress: string;
  };
  readonly payment: {
    readonly unpaid: string;
    readonly partially_paid: string;
    readonly paid: string;
    readonly refunded: string;
  };
  readonly board: {
    readonly RO: string;
    readonly BB: string;
    readonly HB: string;
    readonly FB: string;
    readonly AI: string;
  };
  readonly supplierErrors: {
    readonly sold_out: string;
    readonly price_changed: string;
    readonly invalid_request: string;
    readonly supplier_timeout: string;
    readonly supplier_rejected: string;
    readonly auth_failed: string;
    readonly rate_limited: string;
    readonly supplier_unavailable: string;
  };
  readonly policy: {
    readonly free: string;
    readonly nonRefundable: string;
    readonly until: string;
    readonly from: string;
    readonly now: string;
  };
}

const ar: Messages = {
  common: {
    portalName: "بوابة الوكلاء",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    cancel: "إلغاء",
    confirm: "تأكيد",
    back: "رجوع",
    logout: "تسجيل الخروج",
    switchLocale: "English",
    switchLocaleShort: "EN",
    openNavigation: "فتح قائمة التنقل",
    collapseNavigation: "طي قائمة التنقل",
    genericError: "حدث خطأ غير متوقع. حاول مرة أخرى.",
    sessionExpired: "انتهت الجلسة. الرجاء تسجيل الدخول مجددًا.",
    notFound: "الصفحة غير موجودة.",
  },
  login: {
    title: "تسجيل الدخول",
    subtitle: "بوابة وكلاء السفر",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    submit: "دخول",
    submitting: "جارٍ الدخول…",
    invalidCredentials: "بيانات الدخول غير صحيحة.",
  },
  nav: {
    search: "بحث الفنادق",
    bookings: "الحجوزات",
  },
  search: {
    title: "بحث الفنادق",
    subtitle: "بحث متعدد الغرف عبر جميع المزوّدين المفعّلين",
    destination: "الوجهة",
    destinationPlaceholder: "اختر المدينة",
    destinationLoading: "جارٍ تحميل الوجهات…",
    hotelsOptional: "فنادق محددة (اختياري)",
    hotelsHint: "اتركه فارغًا للبحث في أبرز فنادق الوجهة",
    checkIn: "تاريخ الوصول",
    checkOut: "تاريخ المغادرة",
    nationality: "جنسية النزيل",
    nationalityHint: "تختلف الأسعار حسب الجنسية — حقل إلزامي",
    currency: "العملة",
    rooms: "الغرف",
    room: "غرفة",
    addRoom: "إضافة غرفة",
    removeRoom: "إزالة الغرفة",
    adults: "البالغون",
    children: "الأطفال",
    childAge: "عمر الطفل",
    submit: "ابحث",
    searching: "جارٍ البحث…",
    newSearch: "بحث جديد",
    resultsTitle: "نتائج البحث",
    topHotelsNote: "يشمل البحث أبرز فنادق الوجهة في النسخة التجريبية",
    budgetExhausted: "انتهت مهلة البحث قبل رد بعض المزوّدين — النتائج المعروضة جزئية.",
    streamFailed: "تعذّر إكمال البحث. حاول مرة أخرى.",
    noResults: "لا توجد نتائج مطابقة لبحثك.",
    streamingLabel: "البحث جارٍ",
    filters: "تصفية النتائج",
    filterRefundableOnly: "القابل للاسترداد فقط",
    filterBoard: "نظام الإقامة",
    filterMaxPrice: "الحد الأقصى للسعر",
    filterAll: "الكل",
    perStay: "لكامل الإقامة",
    refundable: "قابل للاسترداد",
    nonRefundable: "غير قابل للاسترداد",
    viewOffer: "عرض التفاصيل",
    offersShown: (shown, total) => `عرض ${String(shown)} من ${String(total)} عرضًا`,
  },
  offer: {
    title: "تفاصيل العرض",
    staySummary: "ملخص الإقامة",
    hotel: "الفندق",
    roomName: "الغرفة",
    board: "نظام الإقامة",
    dates: "التواريخ",
    nights: (n) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتان" : `${String(n)} ليالٍ`),
    occupancy: "الإشغال",
    guests: (adults, children) =>
      children === 0
        ? `${String(adults)} بالغ`
        : `${String(adults)} بالغ · ${String(children)} طفل`,
    nationality: "جنسية النزيل",
    supplier: "المزوّد",
    sellPrice: "سعر البيع",
    cancellationPolicy: "سياسة الإلغاء",
    checkTitle: "التحقق من السعر",
    checkExplainer: "يُعاد التحقق من السعر والتوفر لدى المزوّد قبل تأكيد الحجز.",
    checkButton: "تحقق من السعر والتوفر",
    checking: "جارٍ التحقق…",
    checkedOk: "السعر مؤكد دون تغيير.",
    checkedOkUntil: "يمكنك إتمام الحجز الآن",
    expired: "انتهت صلاحية العرض",
    expiredExplainer: "انتهت صلاحية هذا العرض. ابحث مجددًا للحصول على سعر محدث.",
    missing: "العرض غير متوفر",
    missingExplainer: "تعذّر العثور على بيانات هذا العرض — ابدأ بحثًا جديدًا.",
    backToResults: "العودة إلى النتائج",
    priceChangedTitle: "تغيّر السعر",
    priceChangedExplainer:
      "أفاد المزوّد بسعر مختلف عن السعر المعروض. راجع السعر الجديد ووافق عليه لمتابعة الحجز.",
    policyAlsoChanged: "تغيّرت سياسة الإلغاء أيضًا — راجعها أدناه قبل الموافقة.",
    oldPrice: "السعر السابق",
    newPrice: "السعر الجديد",
    acceptNewPrice: "أوافق على السعر الجديد",
    declineNewPrice: "رفض والعودة للبحث",
    soldOut: "لم يعد هذا العرض متاحًا لدى المزوّد. ابحث مجددًا.",
    checkFailed: "تعذّر التحقق من العرض.",
  },
  book: {
    title: "بيانات الحجز",
    holder: "بيانات صاحب الحجز",
    firstName: "الاسم الأول",
    lastName: "اسم العائلة",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف",
    roomGuests: (room) => `نزلاء الغرفة ${String(room)}`,
    guestAdult: (n) => `بالغ ${String(n)}`,
    guestChild: (n, age) => `طفل ${String(n)} (العمر ${String(age)})`,
    clientReference: "مرجع الوكالة",
    clientReferenceHint: "مفتاح عدم التكرار — لا يُنشأ حجز مزدوج لنفس المرجع أبدًا.",
    submit: "تأكيد الحجز",
    submitting: "جارٍ الحجز…",
    mustCheckFirst: "لا يمكن الحجز قبل التحقق من السعر.",
    validationRequired: "أكمل جميع الحقول المطلوبة.",
    bookFailed: "تعذّر إتمام الحجز.",
    conflictReference: "مرجع الوكالة مستخدم لحجز آخر — استخدم مرجعًا جديدًا.",
  },
  confirmation: {
    title: "تم تأكيد الحجز",
    pendingTitle: "الحجز قيد التأكيد",
    bookingRef: "مرجع الحجز",
    supplierRef: "مرجع المزوّد",
    state: "الحالة",
    amount: "المبلغ",
    idempotentReplay: "هذا الحجز موجود مسبقًا بنفس مرجع الوكالة — لم يُنشأ حجز جديد.",
    voucher: "قسيمة الحجز (PDF)",
    voucherPending: "قسيمة الحجز ستتوفر عند اكتمال خدمة المستندات (M2).",
    goToBooking: "عرض الحجز",
    goToBookings: "إلى قائمة الحجوزات",
  },
  bookings: {
    title: "الحجوزات",
    subtitle: "حجوزات وكالتك",
    empty: "لا توجد حجوزات بعد.",
    loadFailed: "تعذّر تحميل الحجوزات.",
    colReference: "مرجع الوكالة",
    colSupplierRef: "مرجع المزوّد",
    colState: "الحالة",
    colAmount: "المبلغ",
    colCreated: "تاريخ الإنشاء",
    detailTitle: "تفاصيل الحجز",
    item: "عنصر الحجز",
    supplier: "المزوّد",
    paymentState: "حالة السداد",
    history: "سجل الحالة",
    historyEmpty: "لا يوجد سجل.",
    policy: "سياسة الإلغاء",
    sellOnlyNote: "تُعرض أسعار البيع فقط.",
    cancelButton: "إلغاء الحجز",
    cancelNotAllowed: "لا يمكن إلغاء الحجز في حالته الحالية.",
    feePreviewTitle: "معاينة رسوم الإلغاء",
    feePreviewExplainer: "الرسوم أدناه محسوبة من سياسة الإلغاء المخزّنة كما تسري الآن.",
    penaltyNow: "غرامة الإلغاء الآن",
    refundNow: "المبلغ المسترد",
    refundUnknown: "يُحدد المبلغ المسترد عند التسوية.",
    asOf: "حتى",
    confirmCancel: "تأكيد الإلغاء",
    keepBooking: "الإبقاء على الحجز",
    cancelling: "جارٍ الإلغاء…",
    cancelled: "تم إلغاء الحجز.",
    cancellationPending: "الإلغاء قيد المعالجة",
    cancellationPendingExplainer:
      "قبل المزوّد طلب الإلغاء وتجري معالجته. ستُحدَّث الحالة تلقائيًا عند تأكيد المزوّد.",
    cancelFailed: "تعذّر إلغاء الحجز.",
  },
  states: {
    quoted: "عرض سعر",
    reserved: "محجوز مبدئيًا",
    pending_confirmation: "بانتظار التأكيد",
    confirmed: "مؤكد",
    issued: "صادر",
    amendment_pending: "تعديل قيد المعالجة",
    completed: "مكتمل",
    cancelled: "ملغى",
    failed: "فشل",
    escalated: "بحاجة لتدخل يدوي",
    cancellation_in_progress: "الإلغاء قيد المعالجة",
  },
  payment: {
    unpaid: "غير مدفوع",
    partially_paid: "مدفوع جزئيًا",
    paid: "مدفوع",
    refunded: "مسترد",
  },
  board: {
    RO: "غرفة فقط",
    BB: "مع الإفطار",
    HB: "نصف إقامة",
    FB: "إقامة كاملة",
    AI: "شامل جميع الخدمات",
  },
  supplierErrors: {
    sold_out: "نفدت الغرف",
    price_changed: "تغيّر السعر",
    invalid_request: "طلب غير صالح",
    supplier_timeout: "انتهت مهلة المزوّد",
    supplier_rejected: "رفض المزوّد الطلب",
    auth_failed: "فشل الاعتماد لدى المزوّد",
    rate_limited: "تجاوز حد الطلبات",
    supplier_unavailable: "المزوّد غير متاح",
  },
  policy: {
    free: "إلغاء مجاني",
    nonRefundable: "غير قابل للاسترداد",
    until: "حتى",
    from: "اعتبارًا من",
    now: "السارية الآن",
  },
};

const en: Messages = {
  common: {
    portalName: "Agent Portal",
    loading: "Loading…",
    retry: "Retry",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    logout: "Log out",
    switchLocale: "العربية",
    switchLocaleShort: "ع",
    openNavigation: "Open navigation",
    collapseNavigation: "Collapse navigation",
    genericError: "Something went wrong. Please try again.",
    sessionExpired: "Your session has expired. Please log in again.",
    notFound: "Page not found.",
  },
  login: {
    title: "Log in",
    subtitle: "Travel agent portal",
    email: "Email",
    password: "Password",
    submit: "Log in",
    submitting: "Logging in…",
    invalidCredentials: "Invalid credentials.",
  },
  nav: {
    search: "Hotel search",
    bookings: "Bookings",
  },
  search: {
    title: "Hotel search",
    subtitle: "Multi-room search across every enabled supplier",
    destination: "Destination",
    destinationPlaceholder: "Choose a city",
    destinationLoading: "Loading destinations…",
    hotelsOptional: "Specific hotels (optional)",
    hotelsHint: "Leave empty to search the destination's top hotels",
    checkIn: "Check-in",
    checkOut: "Check-out",
    nationality: "Guest nationality",
    nationalityHint: "Rates vary by nationality — always required",
    currency: "Currency",
    rooms: "Rooms",
    room: "Room",
    addRoom: "Add room",
    removeRoom: "Remove room",
    adults: "Adults",
    children: "Children",
    childAge: "Child age",
    submit: "Search",
    searching: "Searching…",
    newSearch: "New search",
    resultsTitle: "Results",
    topHotelsNote: "The alpha searches the destination's top hotels",
    budgetExhausted: "The search budget ran out before every supplier answered — results are partial.",
    streamFailed: "The search could not be completed. Please try again.",
    noResults: "No results match your search.",
    streamingLabel: "Search in progress",
    filters: "Filter results",
    filterRefundableOnly: "Refundable only",
    filterBoard: "Board basis",
    filterMaxPrice: "Max price",
    filterAll: "All",
    perStay: "per stay",
    refundable: "Refundable",
    nonRefundable: "Non-refundable",
    viewOffer: "View offer",
    offersShown: (shown, total) => `Showing ${String(shown)} of ${String(total)} offers`,
  },
  offer: {
    title: "Offer details",
    staySummary: "Stay summary",
    hotel: "Hotel",
    roomName: "Room",
    board: "Board",
    dates: "Dates",
    nights: (n) => (n === 1 ? "1 night" : `${String(n)} nights`),
    occupancy: "Occupancy",
    guests: (adults, children) =>
      children === 0
        ? `${String(adults)} adult${adults === 1 ? "" : "s"}`
        : `${String(adults)} adult${adults === 1 ? "" : "s"} · ${String(children)} child${children === 1 ? "" : "ren"}`,
    nationality: "Guest nationality",
    supplier: "Supplier",
    sellPrice: "Sell price",
    cancellationPolicy: "Cancellation policy",
    checkTitle: "Price check",
    checkExplainer: "Price and availability are revalidated with the supplier before booking.",
    checkButton: "Check price & availability",
    checking: "Checking…",
    checkedOk: "Price confirmed — unchanged.",
    checkedOkUntil: "You can complete the booking now",
    expired: "Offer expired",
    expiredExplainer: "This offer has expired. Search again for a fresh price.",
    missing: "Offer unavailable",
    missingExplainer: "This offer's details are no longer available — start a new search.",
    backToResults: "Back to results",
    priceChangedTitle: "Price changed",
    priceChangedExplainer:
      "The supplier returned a different price. Review and approve the new price to continue.",
    policyAlsoChanged: "The cancellation policy changed too — review it below before approving.",
    oldPrice: "Previous price",
    newPrice: "New price",
    acceptNewPrice: "Accept new price",
    declineNewPrice: "Decline & search again",
    soldOut: "This offer is no longer available from the supplier. Search again.",
    checkFailed: "The offer could not be checked.",
  },
  book: {
    title: "Booking details",
    holder: "Booking holder",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    roomGuests: (room) => `Room ${String(room)} guests`,
    guestAdult: (n) => `Adult ${String(n)}`,
    guestChild: (n, age) => `Child ${String(n)} (age ${String(age)})`,
    clientReference: "Agency reference",
    clientReferenceHint: "Idempotency key — the same reference can never double-book.",
    submit: "Confirm booking",
    submitting: "Booking…",
    mustCheckFirst: "The price must be checked before booking.",
    validationRequired: "Complete all required fields.",
    bookFailed: "The booking could not be completed.",
    conflictReference: "This agency reference was already used for a different booking — use a new one.",
  },
  confirmation: {
    title: "Booking confirmed",
    pendingTitle: "Booking pending confirmation",
    bookingRef: "Booking reference",
    supplierRef: "Supplier reference",
    state: "State",
    amount: "Amount",
    idempotentReplay: "A booking with this agency reference already exists — no new booking was created.",
    voucher: "Voucher (PDF)",
    voucherPending: "The voucher becomes available when the documents service lands (M2).",
    goToBooking: "View booking",
    goToBookings: "Go to bookings",
  },
  bookings: {
    title: "Bookings",
    subtitle: "Your agency's bookings",
    empty: "No bookings yet.",
    loadFailed: "Bookings could not be loaded.",
    colReference: "Agency reference",
    colSupplierRef: "Supplier reference",
    colState: "State",
    colAmount: "Amount",
    colCreated: "Created",
    detailTitle: "Booking details",
    item: "Booking item",
    supplier: "Supplier",
    paymentState: "Payment state",
    history: "State history",
    historyEmpty: "No history.",
    policy: "Cancellation policy",
    sellOnlyNote: "Sell amounts only.",
    cancelButton: "Cancel booking",
    cancelNotAllowed: "This booking cannot be cancelled in its current state.",
    feePreviewTitle: "Cancellation fee preview",
    feePreviewExplainer: "The fee below is computed from the stored cancellation policy as it applies right now.",
    penaltyNow: "Cancellation penalty now",
    refundNow: "Refund",
    refundUnknown: "The refund amount is determined at settlement.",
    asOf: "as of",
    confirmCancel: "Confirm cancellation",
    keepBooking: "Keep booking",
    cancelling: "Cancelling…",
    cancelled: "The booking was cancelled.",
    cancellationPending: "Cancellation in progress",
    cancellationPendingExplainer:
      "The supplier accepted the cancellation and is processing it. The state updates automatically once the supplier confirms.",
    cancelFailed: "The booking could not be cancelled.",
  },
  states: {
    quoted: "Quoted",
    reserved: "Reserved",
    pending_confirmation: "Pending confirmation",
    confirmed: "Confirmed",
    issued: "Issued",
    amendment_pending: "Amendment pending",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Failed",
    escalated: "Needs attention",
    cancellation_in_progress: "Cancellation in progress",
  },
  payment: {
    unpaid: "Unpaid",
    partially_paid: "Partially paid",
    paid: "Paid",
    refunded: "Refunded",
  },
  board: {
    RO: "Room only",
    BB: "Bed & breakfast",
    HB: "Half board",
    FB: "Full board",
    AI: "All inclusive",
  },
  supplierErrors: {
    sold_out: "Sold out",
    price_changed: "Price changed",
    invalid_request: "Invalid request",
    supplier_timeout: "Supplier timeout",
    supplier_rejected: "Rejected by supplier",
    auth_failed: "Supplier authentication failed",
    rate_limited: "Rate limited",
    supplier_unavailable: "Supplier unavailable",
  },
  policy: {
    free: "Free cancellation",
    nonRefundable: "Non-refundable",
    until: "until",
    from: "from",
    now: "current",
  },
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { ar, en };
