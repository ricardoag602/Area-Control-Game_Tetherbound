import { GAME_RULES } from "../constants";

interface TetherResourcesProps {
  bankedSalvage: number;
  carriedSalvage: number;
  tetherKits: number;
  deployReady: boolean;
}

/**
 * A compact, visual recipe meter. Cyan material is already banked at the
 * fabricator, while gold material is still being carried by the astronaut.
 */
export function TetherResources({
  bankedSalvage,
  carriedSalvage,
  tetherKits,
  deployReady,
}: TetherResourcesProps) {
  const recipeSize = GAME_RULES.salvagePerTether;
  const visibleSlotCount = GAME_RULES.salvageCarryLimit;
  const totalSalvage = bankedSalvage + carriedSalvage;
  const visibleProgress = Math.min(visibleSlotCount, totalSalvage);
  const overflow = Math.max(0, totalSalvage - visibleSlotCount);
  const fabricationReady = carriedSalvage > 0 && totalSalvage >= recipeSize;
  const description = `${tetherKits} tether ${tetherKits === 1 ? "kit" : "kits"}. ${bankedSalvage} ${bankedSalvage === 1 ? "material is" : "materials are"} banked and ${carriedSalvage} ${carriedSalvage === 1 ? "is" : "are"} carried. You can carry up to ${GAME_RULES.salvageCarryLimit}; ${recipeSize} materials fabricate a tether.`;

  return (
    <div
      className={`tether-resources${fabricationReady ? " tether-resources--fabrication-ready" : ""}${deployReady ? " tether-resources--deploy-ready" : ""}`}
      aria-label={description}
      title={description}
    >
      <div className="tether-resources__recipe" aria-hidden="true">
        <div className="tether-resources__slots">
          {Array.from({ length: visibleSlotCount }, (_, index) => {
            const state = index < bankedSalvage
              ? "banked"
              : index < visibleProgress
                ? "carried"
                : "empty";

            return (
              <span
                className={`tether-resources__slot tether-resources__slot--${state}`}
                key={index}
              />
            );
          })}
        </div>
        {overflow > 0 && (
          <strong className="tether-resources__overflow">+{overflow}</strong>
        )}
      </div>
      <span className="tether-resources__divider" aria-hidden="true" />
      <div className="tether-resources__kits" aria-hidden="true">
        <span className="tether-resources__spool" />
        <strong>{tetherKits}</strong>
        <small>Tethers</small>
      </div>
    </div>
  );
}
