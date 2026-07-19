/**
 * SCORM 1.2 RTE error codes (contracts/scorm-runtime-api.md §Error Codes) — implemented entirely
 * client-side inside the `window.API` object (spec FR-009). Governs the object's own state-machine and
 * data-model validation, independent of any network call.
 */
export const SCORM_ERROR_CODES = {
  NO_ERROR: "0",
  GENERAL_EXCEPTION: "101",
  INVALID_ARGUMENT: "201",
  ELEMENT_CANNOT_HAVE_CHILDREN: "202",
  ELEMENT_NOT_AN_ARRAY: "203",
  NOT_INITIALIZED: "301",
  NOT_IMPLEMENTED: "401",
  INVALID_SET_VALUE_KEYWORD: "402",
  ELEMENT_READ_ONLY: "403",
  ELEMENT_WRITE_ONLY: "404",
  INCORRECT_DATA_TYPE: "405",
} as const;

export type ScormErrorCode = (typeof SCORM_ERROR_CODES)[keyof typeof SCORM_ERROR_CODES];

export const SCORM_ERROR_STRINGS: Record<ScormErrorCode, string> = {
  [SCORM_ERROR_CODES.NO_ERROR]: "No error",
  [SCORM_ERROR_CODES.GENERAL_EXCEPTION]: "General exception",
  [SCORM_ERROR_CODES.INVALID_ARGUMENT]: "Invalid argument error",
  [SCORM_ERROR_CODES.ELEMENT_CANNOT_HAVE_CHILDREN]: "Element cannot have children",
  [SCORM_ERROR_CODES.ELEMENT_NOT_AN_ARRAY]: "Element not an array — cannot have count",
  [SCORM_ERROR_CODES.NOT_INITIALIZED]: "Not initialized",
  [SCORM_ERROR_CODES.NOT_IMPLEMENTED]: "Not implemented error",
  [SCORM_ERROR_CODES.INVALID_SET_VALUE_KEYWORD]: "Invalid set value, element is a keyword",
  [SCORM_ERROR_CODES.ELEMENT_READ_ONLY]: "Element is read only",
  [SCORM_ERROR_CODES.ELEMENT_WRITE_ONLY]: "Element is write only",
  [SCORM_ERROR_CODES.INCORRECT_DATA_TYPE]: "Incorrect data type",
};
