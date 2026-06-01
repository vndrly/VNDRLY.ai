const { withProjectBuildGradle } = require("expo/config-plugins");

/** Align Kotlin JVM target with Java 17 for all Android subprojects. */
module.exports = function withKotlinJvmTarget(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      return gradleConfig;
    }

    const marker = "Align Kotlin JVM target with Java 17";
    if (gradleConfig.modResults.contents.includes(marker)) {
      return gradleConfig;
    }

    gradleConfig.modResults.contents += `

// ${marker} (expo-dynamic-app-icon and other native modules).
subprojects { subproject ->
  subproject.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
      jvmTarget = "17"
    }
  }
}
`;

    return gradleConfig;
  });
};
