import type { components, operations } from './schema'

export type Publication = components['schemas']['Publication']
export type AnalysisVersion = components['schemas']['AnalysisVersion']
export type PublicationDetail = components['schemas']['PublicationDetail']
export type PublicationList = components['schemas']['PublicationList']
export type PublicationHistory = components['schemas']['PublicationHistory']
export type SpecialistDecision = components['schemas']['SpecialistDecision']
export type SpecialistDecisionCreate = components['schemas']['SpecialistDecisionCreate']
export type RegulatoryCase = components['schemas']['RegulatoryCase']
export type RegulatoryCaseDetail = components['schemas']['RegulatoryCaseDetail']
export type LifecycleEvent = components['schemas']['LifecycleEvent']
export type LifecycleEventCreate = components['schemas']['LifecycleEventCreate']
export type LifecycleStage = components['schemas']['LifecycleStage']
export type ConfirmationSourceType = LifecycleEventCreate['confirmation_source_type']
export type Source = components['schemas']['Source']
export type ApiErrorBody = components['schemas']['Error']
export type Category = components['schemas']['Category']
export type Priority = components['schemas']['Priority']
export type DecisionStatus = components['schemas']['DecisionStatus']
export type SourceType = components['schemas']['SourceType']
export type PublicationQuery = NonNullable<
  operations['listPublications']['parameters']['query']
>
