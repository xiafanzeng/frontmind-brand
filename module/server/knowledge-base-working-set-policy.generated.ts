// Generated from workflows/socratic-kb-builder/references/working-set-policy.json.
// Run `node workflows/generate-knowledge-base-working-set-policy.mjs` after changing the source.
// prettier-ignore
export const GENERATED_KNOWLEDGE_BASE_WORKING_SET_POLICY = {
  "schemaVersion": 1,
  "archive": {
    "maxCompressedBytes": 125829120,
    "maxUncompressedBytes": 125829120,
    "maxEntryCount": 1500,
    "maxCompressionRatio": 200,
    "maxAssetBytes": 20971520,
    "patchWarningLimit": 50
  },
  "evidence": {
    "textExtensions": [
      ".md",
      ".markdown",
      ".txt"
    ],
    "textMimeTypes": [
      "text/markdown",
      "text/plain"
    ],
    "optionalBinary": {
      "disposition": "drop",
      "warning": {
        "code": "OPTIONAL_BINARY_EVIDENCE_SKIPPED",
        "area": "evidence"
      }
    },
    "optionalInvalidText": {
      "disposition": "drop",
      "warning": {
        "code": "EVIDENCE_INCOMPLETE",
        "area": "evidence"
      }
    }
  },
  "authority": {
    "initial": {
      "hard": [
        "operationId",
        "archiveSafety",
        "manifestMultiplicity"
      ],
      "serverOwned": [
        "buildId",
        "generation",
        "contentVersion",
        "skill",
        "treePolicyVersion",
        "company"
      ]
    },
    "revision": {
      "hard": [
        "operationId",
        "baseWorkingSetSha256",
        "targetLeafId",
        "archiveSafety",
        "manifestMultiplicity",
        "removalOwnership",
        "frozenUploadBytes"
      ],
      "serverOwned": [
        "buildId",
        "generation",
        "baseContentVersion"
      ]
    }
  },
  "warnings": {
    "serverCoordinateNormalized": {
      "code": "SERVER_COORDINATE_NORMALIZED",
      "area": "manifest"
    },
    "evidenceIncomplete": {
      "code": "EVIDENCE_INCOMPLETE",
      "area": "evidence"
    },
    "optionalBinaryEvidenceSkipped": {
      "code": "OPTIONAL_BINARY_EVIDENCE_SKIPPED",
      "area": "evidence"
    },
    "optionalAssetSkipped": {
      "code": "OPTIONAL_ASSET_SKIPPED",
      "area": "assets"
    },
    "resultIncomplete": {
      "code": "RESULT_INCOMPLETE"
    },
    "presentationNormalized": {
      "code": "PRESENTATION_NORMALIZED"
    }
  },
  "depth": {
    "version": "knowledge_depth_v6",
    "skillVersion": "6",
    "evidenceThreshold": 1500,
    "minimumBodyCharacters": 300,
    "maximumRewritePasses": 1,
    "evidenceIndependence": {
      "minimumBodyCharacters": 80,
      "maximumExtraCharacters": 200,
      "legacySkillContentHashes": [
        "3a2b025caea4c6e6921eb397e1daf5792c5825475918a9db5f880ce9695d1155"
      ]
    },
    "leafTarget": [
      600,
      1200
    ],
    "coreLeafTarget": [
      800,
      1800
    ],
    "overviewTarget": [
      1200,
      2500
    ],
    "evidenceTraceability": {
      "minimumBodyCharacters": 600,
      "minimumSharedLeaves": 5,
      "minimumSharedBranches": 3,
      "legacySkillContentHashes": [
        "3a2b025caea4c6e6921eb397e1daf5792c5825475918a9db5f880ce9695d1155",
        "d755fea93a08163a6d39fa04dcdb4b14abeffbede24ee49479845db4bb5df30d"
      ],
      "quantityUnits": [
        "平方米",
        "人次",
        "人时",
        "小时",
        "分钟",
        "公里",
        "千米",
        "学时",
        "专业",
        "%",
        "人",
        "名",
        "个",
        "项",
        "所",
        "家",
        "门",
        "套",
        "台",
        "本",
        "册",
        "部",
        "亩",
        "元",
        "年",
        "月",
        "天",
        "次",
        "组",
        "条",
        "间",
        "篇",
        "件",
        "位"
      ],
      "quantityUnitAliases": {
        "名": "人",
        "千米": "公里"
      }
    },
    "bodySubstance": {
      "minimumBodyCharacters": 600,
      "minimumSharedParagraphCharacters": 40,
      "minimumSharedLeaves": 5,
      "minimumSharedBranches": 3,
      "minimumExceptionDetailCharacters": 20,
      "legacySkillContentHashes": [
        "3a2b025caea4c6e6921eb397e1daf5792c5825475918a9db5f880ce9695d1155",
        "d755fea93a08163a6d39fa04dcdb4b14abeffbede24ee49479845db4bb5df30d",
        "b3b384c8ec3d9151d9701cff843feba7ef1f5bed2397f4590aace2b99d5bcb7d"
      ],
      "literalTitleNormalizationLegacyHashes": [
        "3a2b025caea4c6e6921eb397e1daf5792c5825475918a9db5f880ce9695d1155",
        "d755fea93a08163a6d39fa04dcdb4b14abeffbede24ee49479845db4bb5df30d",
        "b3b384c8ec3d9151d9701cff843feba7ef1f5bed2397f4590aace2b99d5bcb7d",
        "a183dac64d9ebacd28382696ee9e41da50141e4aac1022dd449d442e3034db2c"
      ]
    },
    "quotedEvidence": {
      "legacySkillContentHashes": [
        "3a2b025caea4c6e6921eb397e1daf5792c5825475918a9db5f880ce9695d1155",
        "d755fea93a08163a6d39fa04dcdb4b14abeffbede24ee49479845db4bb5df30d",
        "b3b384c8ec3d9151d9701cff843feba7ef1f5bed2397f4590aace2b99d5bcb7d",
        "a183dac64d9ebacd28382696ee9e41da50141e4aac1022dd449d442e3034db2c",
        "0b6f84bd96f9b4cb449d28107243320d8674e4688a46a51f1b08c84f1789e171"
      ]
    }
  }
} as const;
