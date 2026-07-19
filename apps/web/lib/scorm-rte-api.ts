import { SCORM_ERROR_CODES, SCORM_ERROR_STRINGS, type ScormErrorCode } from "./scorm-cmi-error-codes";

const SUSPEND_DATA_MAX_LENGTH = 4096;

export interface LaunchDataObjective {
  objectiveId: string | null;
  status: string | null;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
}

export interface LaunchDataInteraction {
  interactionId: string | null;
  type: string | null;
  weighting: number | null;
  studentResponse: string | null;
  result: string | null;
  latency: string | null;
  correctResponses: unknown;
}

export interface LaunchData {
  packageId: string;
  entryPointUrl: string;
  cmi: {
    lessonStatus: string;
    scoreRaw: number | null;
    scoreMin: number | null;
    scoreMax: number | null;
    bookmark: string | null;
    suspendData: string | null;
    totalTimeSeconds: number;
    entry: "ab-initio" | "resume";
    objectives: LaunchDataObjective[];
    interactions: LaunchDataInteraction[];
  };
  studentId: string;
  studentName: string;
}

/** The plain `LMS*` function object SCORM 1.2 requires — every function returns a string, per the
 * standard's own calling convention (research.md §6). Never a class instance exposing anything else;
 * SCOs only ever call these eight names. */
export interface ScormApi {
  LMSInitialize: (param: string) => string;
  LMSFinish: (param: string) => string;
  LMSGetValue: (element: string) => string;
  LMSSetValue: (element: string, value: string) => string;
  LMSCommit: (param: string) => string;
  LMSGetLastError: () => string;
  LMSGetErrorString: (errorCode: string) => string;
  LMSGetDiagnostic: (errorCode: string) => string;
}

type RteState = "not_initialized" | "initialized" | "terminated";

/** Read-only per SCORM 1.2's own RTE spec — `LMSSetValue` against any of these fails with 403. */
const READ_ONLY_ELEMENTS = new Set(["cmi.core.student_id", "cmi.core.student_name", "cmi.core.credit", "cmi.core.entry", "cmi.core.total_time"]);

/**
 * Builds the `window.API` object for one SCO launch session (spec FR-005/FR-006/FR-009/FR-010,
 * contracts §Error Codes). The in-memory CMI model is seeded from `launchData` (server-fetched once,
 * synchronously available before the SCO's first call); `LMSGetValue`/`LMSSetValue` are pure in-memory
 * operations with zero network calls; only `LMSCommit`/`LMSFinish` reach the network, via a synchronous
 * XHR (research.md §6) since SCORM's calling convention has no notion of async.
 */
export function createScormApi(launchData: LaunchData, contentItemId: string): ScormApi {
  let state: RteState = "not_initialized";
  let lastError: ScormErrorCode = SCORM_ERROR_CODES.NO_ERROR;

  const cmi = {
    lessonStatus: launchData.cmi.lessonStatus,
    scoreRaw: launchData.cmi.scoreRaw,
    scoreMin: launchData.cmi.scoreMin,
    scoreMax: launchData.cmi.scoreMax,
    lessonLocation: launchData.cmi.bookmark ?? "",
    suspendData: launchData.cmi.suspendData ?? "",
    sessionTimeSeconds: 0,
    entry: launchData.cmi.entry,
    // cmi.student_preference.* is not persisted server-side (not part of spec FR-007/FR-008's
    // binding scope) — in-memory only for the lifetime of this session.
    studentPreference: { audio: "0", language: "", speed: "0", text: "0" },
    objectives: launchData.cmi.objectives.map((o) => ({ ...o })),
    interactions: launchData.cmi.interactions.map((i) => ({ ...i })),
  };

  function setError(code: ScormErrorCode) {
    lastError = code;
  }

  function commit(): boolean {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/tenant-api/tenant/content-items/${contentItemId}/scorm/cmi`, false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true;
    try {
      xhr.send(
        JSON.stringify({
          lessonStatus: cmi.lessonStatus,
          scoreRaw: cmi.scoreRaw,
          scoreMin: cmi.scoreMin,
          scoreMax: cmi.scoreMax,
          bookmark: cmi.lessonLocation,
          suspendData: cmi.suspendData,
          sessionTimeSeconds: cmi.sessionTimeSeconds,
          objectives: cmi.objectives,
          interactions: cmi.interactions,
        }),
      );
    } catch {
      setError(SCORM_ERROR_CODES.GENERAL_EXCEPTION);
      return false;
    }
    if (xhr.status !== 200) {
      setError(SCORM_ERROR_CODES.GENERAL_EXCEPTION);
      return false;
    }
    setError(SCORM_ERROR_CODES.NO_ERROR);
    return true;
  }

  function objectiveMatch(element: string): { index: number; field: string } | null {
    const match = element.match(/^cmi\.objectives\.(\d+)\.(.+)$/);
    if (!match) return null;
    return { index: Number(match[1]), field: match[2] };
  }

  function interactionMatch(element: string): { index: number; field: string } | null {
    const match = element.match(/^cmi\.interactions\.(\d+)\.(.+)$/);
    if (!match) return null;
    return { index: Number(match[1]), field: match[2] };
  }

  function getValue(element: string): string | null {
    switch (element) {
      case "cmi.core.student_id":
        return launchData.studentId;
      case "cmi.core.student_name":
        return launchData.studentName;
      case "cmi.core.lesson_status":
        return cmi.lessonStatus;
      case "cmi.core.score.raw":
        return cmi.scoreRaw === null ? "" : String(cmi.scoreRaw);
      case "cmi.core.score.min":
        return cmi.scoreMin === null ? "" : String(cmi.scoreMin);
      case "cmi.core.score.max":
        return cmi.scoreMax === null ? "" : String(cmi.scoreMax);
      case "cmi.core.lesson_location":
        return cmi.lessonLocation;
      case "cmi.core.entry":
        return cmi.entry === "resume" ? "resume" : "ab-initio";
      case "cmi.core.credit":
        return "credit";
      case "cmi.core.total_time":
        return String(launchData.cmi.totalTimeSeconds);
      case "cmi.suspend_data":
        return cmi.suspendData;
      case "cmi.objectives._count":
        return String(cmi.objectives.length);
      case "cmi.interactions._count":
        return String(cmi.interactions.length);
      case "cmi.student_preference.audio":
        return cmi.studentPreference.audio;
      case "cmi.student_preference.language":
        return cmi.studentPreference.language;
      case "cmi.student_preference.speed":
        return cmi.studentPreference.speed;
      case "cmi.student_preference.text":
        return cmi.studentPreference.text;
      default:
        break;
    }

    const objective = objectiveMatch(element);
    if (objective) {
      const row = cmi.objectives[objective.index];
      if (!row) return "";
      switch (objective.field) {
        case "id":
          return row.objectiveId ?? "";
        case "status":
          return row.status ?? "";
        case "score.raw":
          return row.scoreRaw === null ? "" : String(row.scoreRaw);
        case "score.min":
          return row.scoreMin === null ? "" : String(row.scoreMin);
        case "score.max":
          return row.scoreMax === null ? "" : String(row.scoreMax);
        default:
          return null;
      }
    }

    const interaction = interactionMatch(element);
    if (interaction) {
      const row = cmi.interactions[interaction.index];
      if (!row) return "";
      switch (interaction.field) {
        case "id":
          return row.interactionId ?? "";
        case "type":
          return row.type ?? "";
        case "weighting":
          return row.weighting === null ? "" : String(row.weighting);
        case "student_response":
          return row.studentResponse ?? "";
        case "result":
          return row.result ?? "";
        case "latency":
          return row.latency ?? "";
        default:
          return null;
      }
    }

    return null;
  }

  function setValue(element: string, value: string): boolean {
    switch (element) {
      case "cmi.core.lesson_status":
        cmi.lessonStatus = value;
        return true;
      case "cmi.core.score.raw":
        cmi.scoreRaw = value === "" ? null : Number(value);
        return true;
      case "cmi.core.score.min":
        cmi.scoreMin = value === "" ? null : Number(value);
        return true;
      case "cmi.core.score.max":
        cmi.scoreMax = value === "" ? null : Number(value);
        return true;
      case "cmi.core.lesson_location":
        cmi.lessonLocation = value;
        return true;
      case "cmi.core.session_time":
        cmi.sessionTimeSeconds = parseScormTimeToSeconds(value);
        return true;
      case "cmi.suspend_data":
        if (value.length > SUSPEND_DATA_MAX_LENGTH) {
          setError(SCORM_ERROR_CODES.GENERAL_EXCEPTION);
          return false;
        }
        cmi.suspendData = value;
        return true;
      case "cmi.student_preference.audio":
        cmi.studentPreference.audio = value;
        return true;
      case "cmi.student_preference.language":
        cmi.studentPreference.language = value;
        return true;
      case "cmi.student_preference.speed":
        cmi.studentPreference.speed = value;
        return true;
      case "cmi.student_preference.text":
        cmi.studentPreference.text = value;
        return true;
      default:
        break;
    }

    const objective = objectiveMatch(element);
    if (objective) {
      while (cmi.objectives.length <= objective.index) {
        cmi.objectives.push({ objectiveId: null, status: null, scoreRaw: null, scoreMin: null, scoreMax: null });
      }
      const row = cmi.objectives[objective.index];
      switch (objective.field) {
        case "id":
          row.objectiveId = value;
          return true;
        case "status":
          row.status = value;
          return true;
        case "score.raw":
          row.scoreRaw = value === "" ? null : Number(value);
          return true;
        case "score.min":
          row.scoreMin = value === "" ? null : Number(value);
          return true;
        case "score.max":
          row.scoreMax = value === "" ? null : Number(value);
          return true;
        default:
          return false;
      }
    }

    const interaction = interactionMatch(element);
    if (interaction) {
      while (cmi.interactions.length <= interaction.index) {
        cmi.interactions.push({ interactionId: null, type: null, weighting: null, studentResponse: null, result: null, latency: null, correctResponses: null });
      }
      const row = cmi.interactions[interaction.index];
      switch (interaction.field) {
        case "id":
          row.interactionId = value;
          return true;
        case "type":
          row.type = value;
          return true;
        case "weighting":
          row.weighting = value === "" ? null : Number(value);
          return true;
        case "student_response":
          row.studentResponse = value;
          return true;
        case "result":
          row.result = value;
          return true;
        case "latency":
          row.latency = value;
          return true;
        default:
          return false;
      }
    }

    return false;
  }

  return {
    LMSInitialize(param: string): string {
      if (param !== "") {
        setError(SCORM_ERROR_CODES.INVALID_ARGUMENT);
        return "false";
      }
      if (state !== "not_initialized") {
        setError(SCORM_ERROR_CODES.GENERAL_EXCEPTION);
        return "false";
      }
      state = "initialized";
      setError(SCORM_ERROR_CODES.NO_ERROR);
      return "true";
    },

    LMSFinish(param: string): string {
      if (param !== "") {
        setError(SCORM_ERROR_CODES.INVALID_ARGUMENT);
        return "false";
      }
      if (state !== "initialized") {
        setError(SCORM_ERROR_CODES.NOT_INITIALIZED);
        return "false";
      }
      const committed = commit();
      state = "terminated";
      return committed ? "true" : "false";
    },

    LMSGetValue(element: string): string {
      if (state !== "initialized") {
        setError(SCORM_ERROR_CODES.NOT_INITIALIZED);
        return "";
      }
      if (READ_ONLY_ELEMENTS.has(element) === false && element.endsWith("._children")) {
        setError(SCORM_ERROR_CODES.ELEMENT_CANNOT_HAVE_CHILDREN);
        return "";
      }
      const value = getValue(element);
      if (value === null) {
        setError(SCORM_ERROR_CODES.NOT_IMPLEMENTED);
        return "";
      }
      setError(SCORM_ERROR_CODES.NO_ERROR);
      return value;
    },

    LMSSetValue(element: string, value: string): string {
      if (state !== "initialized") {
        setError(SCORM_ERROR_CODES.NOT_INITIALIZED);
        return "false";
      }
      if (READ_ONLY_ELEMENTS.has(element)) {
        setError(SCORM_ERROR_CODES.ELEMENT_READ_ONLY);
        return "false";
      }
      const ok = setValue(element, value);
      if (!ok) {
        if (lastError === SCORM_ERROR_CODES.NO_ERROR) {
          setError(SCORM_ERROR_CODES.NOT_IMPLEMENTED);
        }
        return "false";
      }
      setError(SCORM_ERROR_CODES.NO_ERROR);
      return "true";
    },

    LMSCommit(param: string): string {
      if (param !== "") {
        setError(SCORM_ERROR_CODES.INVALID_ARGUMENT);
        return "false";
      }
      if (state !== "initialized") {
        setError(SCORM_ERROR_CODES.NOT_INITIALIZED);
        return "false";
      }
      return commit() ? "true" : "false";
    },

    LMSGetLastError(): string {
      return lastError;
    },

    LMSGetErrorString(errorCode: string): string {
      return SCORM_ERROR_STRINGS[errorCode as ScormErrorCode] ?? "";
    },

    LMSGetDiagnostic(errorCode: string): string {
      return SCORM_ERROR_STRINGS[errorCode as ScormErrorCode] ?? "";
    },
  };
}

/** SCORM 1.2's `cmi.core.session_time` uses `HHHH:MM:SS.SS` — converts to whole seconds for the
 * backend's own `sessionTimeSeconds` field. */
function parseScormTimeToSeconds(value: string): number {
  const match = value.match(/^(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
