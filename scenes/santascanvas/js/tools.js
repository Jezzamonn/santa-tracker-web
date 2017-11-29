/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

goog.provide('app.Tools');
goog.require('app.Eraser');
goog.require('app.LayerTool');
goog.require('app.Marker');
goog.require('app.Neon');
goog.require('app.PaintRoller');
goog.require('app.PenBells');
goog.require('app.PenGarland');
goog.require('app.PenHangingLights');
goog.require('app.PenStringLights');
goog.require('app.Pencil');
goog.require('app.Shape');
goog.require('app.SprayColor');
goog.require('app.SprayPattern');
goog.require('app.SpraySnow');
goog.require('app.Stamp');
goog.require('app.Sticker');
goog.require('app.TextureDrawer');
goog.require('app.Tool');
goog.require('app.utils');
goog.require('app.shared.utils');


/**
 * The toolbox
 * @param {!app.Game} game
 * @param {!jQuery} $elem
 * @constructor
 */
app.Tools = function(game, $elem) {
  this.game_ = game;

  this.sliders = $('[data-slider]', $elem);
  this.rotators = $('[data-rotator]', $elem);

  this.primaryMenu = $elem.find('.Tools--primary');
  this.categoryPickers = this.primaryMenu.find('[data-tool-category-picker]');
  this.toolDisplay = this.primaryMenu.find('[data-tool-display]');

  this.secondaryMenu = $elem.find('.Tools--secondary');
  this.categoryMenus = this.secondaryMenu.find('[data-tool-category-menu]');
  this.categoryMenuNavs = this.categoryMenus.find('[data-tool-category-nav]');
  this.categoryMenuNavBtns = this.categoryMenuNavs.find('[data-tool-nav]');

  this.subcategoryPickers = this.categoryMenus.find('[data-tool-subcategory-picker]');
  this.subcategoryMenus = this.categoryMenus.find('[data-tool-subcategory-menu]');

  this.tertiaryMenu = $elem.find('.Tools--tertiary');
  this.tertiaryMenuMobile = this.tertiaryMenu.find('.Tools-mobile');
  this.mobileEdit = this.tertiaryMenuMobile.find('.Tools-edit');
  this.mobileRotate = this.tertiaryMenuMobile.find('.Tools-rotator');
  this.mobileSlider = this.tertiaryMenuMobile.find('.Tools-slider');
  this.mobileEraser = this.tertiaryMenuMobile.find('[data-tool="eraser-mobile"]');

  this.categoryPickers.on('click.santascanvas touchend.santascanvas', this.onCategoryClick_.bind(this));
  this.subcategoryPickers.on('click.santascanvas touchend.santascanvas', this.onSubcategoryClick_.bind(this));
  this.categoryMenuNavBtns.on('click.santascanvas touchend.santascanvas', this.onNavClick_.bind(this));
  this.mobileEraser.on('touchend.santascanvas', this.onCategoryClick_.bind(this));

  this.pencil = new app.TextureDrawer($elem, 'pencil', {
      opacity: 0.5,
      drawFrequency: 7,
      sizeConfig: {
        min: app.Constants.PENCIL_MIN,
        max: app.Constants.PENCIL_MAX
      }
    });
  this.crayon = new app.TextureDrawer($elem, 'crayon');
  this.marker = new app.Marker($elem, 'marker');
  this.paintbrush = new app.TextureDrawer($elem, 'paintbrush', { opacity: 0.5 });
  this.tinsel = new app.TextureDrawer($elem, 'tinsel', {
      sizeConfig: {
        min: app.Constants.TINSEL_MIN,
        max: app.Constants.TINSEL_MAX,
        scale: true
      },
      monotone: true
    });
  this.icing = new app.TextureDrawer($elem, 'icing', {
      sizeConfig: {
        min: app.Constants.FROSTING_MIN,
        max: app.Constants.FROSTING_MAX,
        scale: true
      },
      noRotation: true,
      monotone: true,
      drawFrequency: 8
    });
  this.garland = new app.PenGarland($elem, 'garland', {
      sizeConfig: {
        min: 0.5,
        max: 5,
        scale: true
      }
    });
  this.neon = new app.Neon($elem, 'neon');
  this.bell = new app.PenBells($elem, 'bell', {
      sizeConfig: {
        min: 0.1,
        max: 0.3,
        scale: true
      }
    });
  this.hangingLights = new app.PenHangingLights($elem, 'hanging-lights', {
      sizeConfig: {
        min: 0.1,
        max: 0.3,
        scale: true
      }
    });
  this.stringLights = new app.PenStringLights($elem, 'string-lights', {
      sizeConfig: {
        min: 0.25,
        max: 1,
        scale: true
      }
    });

  this.spray = new app.SprayColor($elem, 'spray-color');
  this.spraySprinkles = new app.SprayPattern($elem, 'spray-sprinkles', app.Constants.SPRINKLE_SPRAY_CONFIG);
  this.sprayCandy = new app.SprayPattern($elem, 'spray-candy', app.Constants.CANDY_SPRAY_CONFIG);
  this.sprayConfetti = new app.SprayPattern($elem, 'spray-confetti', app.Constants.CONFETTI_SPRAY_CONFIG);
  this.sprayHoliday = new app.SprayPattern($elem, 'spray-holiday', app.Constants.HOLIDAY_SPRAY_CONFIG);
  this.sprayOcean = new app.SprayPattern($elem, 'spray-ocean', app.Constants.OCEAN_SPRAY_CONFIG);
  this.sprayOrnaments = new app.SprayPattern($elem, 'spray-ornaments', app.Constants.ORNAMENT_SPRAY_CONFIG);
  this.spraySnow = new app.SpraySnow($elem, 'spray-snow');
  this.spraySnowflakes = new app.SprayPattern($elem, 'spray-snowflakes', app.Constants.SNOWFLAKE_SPRAY_CONFIG);


  this.sceneAir = new app.LayerTool($elem, 'air', app.LayerTool.Layer.BACKGROUND);
  this.sceneAirport = new app.LayerTool($elem, 'airport', app.LayerTool.Layer.BACKGROUND);
  this.sceneBeach = new app.LayerTool($elem, 'beach', app.LayerTool.Layer.BACKGROUND);
  this.sceneDock = new app.LayerTool($elem, 'dock', app.LayerTool.Layer.BACKGROUND);
  this.sceneIceberg = new app.LayerTool($elem, 'iceberg', app.LayerTool.Layer.BACKGROUND);
  this.sceneLivingroom = new app.LayerTool($elem, 'livingroom', app.LayerTool.Layer.BACKGROUND);
  this.sceneNight = new app.LayerTool($elem, 'night', app.LayerTool.Layer.BACKGROUND);
  this.sceneNone = new app.LayerTool($elem, 'none', app.LayerTool.Layer.BACKGROUND);
  this.sceneSnow = new app.LayerTool($elem, 'snow', app.LayerTool.Layer.BACKGROUND);
  this.sceneUnderwater = new app.LayerTool($elem, 'underwater', app.LayerTool.Layer.BACKGROUND);
  this.eraser = new app.Eraser($elem, 'eraser');
  this.eraserMobile = new app.Eraser($elem, 'eraser-mobile');
  this.shapeCircle = new app.Shape($elem, 'circle');
  this.shapeDiamond = new app.Shape($elem, 'diamond');
  this.shapeHeart = new app.Shape($elem, 'heart');
  this.shapeOctagon = new app.Shape($elem, 'octagon');
  this.shapePentagon = new app.Shape($elem, 'pentagon');
  this.shapeRectangle = new app.Shape($elem, 'rectangle');
  this.shapeSquare = new app.Shape($elem, 'square');
  this.shapeStar = new app.Shape($elem, 'star');
  this.shapeTriangle = new app.Shape($elem, 'triangle');
  this.stampBow = new app.Stamp($elem, 'bow');
  this.stampPresent = new app.Stamp($elem, 'present');
  this.stampOrnamentRound1 = new app.Stamp($elem, 'ornament-round1');
  this.stampOrnamentRound2 = new app.Stamp($elem, 'ornament-round2');
  this.stampOrnamentRound3 = new app.Stamp($elem, 'ornament-round3');
  this.stampOrnamentSkinny1 = new app.Stamp($elem, 'ornament-skinny1');
  this.stampOrnamentSkinny2 = new app.Stamp($elem, 'ornament-skinny2');
  this.stampOrnamentWide1 = new app.Stamp($elem, 'ornament-wide1');
  this.stampOrnamentWide2 = new app.Stamp($elem, 'ornament-wide2');
  this.stampCandyGumdrop = new app.Stamp($elem, 'candy-gumdrop');
  this.stampCandyJellybean = new app.Stamp($elem, 'candy-jellybean');
  this.stampCandyMintSwirl = new app.Stamp($elem, 'candy-mint-swirl');
  this.stampCandyMintWheel = new app.Stamp($elem, 'candy-mint-wheel');
  this.stampCandySucker = new app.Stamp($elem, 'candy-sucker');
  this.stampCandyWrapper1 = new app.Stamp($elem, 'candy-wrapper1');
  this.stampCandyWrapper2 = new app.Stamp($elem, 'candy-wrapper2');
  this.rollerCheckered = new app.PaintRoller($elem, 'checkered');
  this.rollerDiagonal = new app.PaintRoller($elem, 'diagonal');
  this.rollerHorizontal = new app.PaintRoller($elem, 'horizontal');
  this.rollerPolkadots = new app.PaintRoller($elem, 'polkadots');
  this.rollerSnowflakes = new app.PaintRoller($elem, 'snowflakes');
  this.rollerTrees = new app.PaintRoller($elem, 'trees');
  this.rollerVertical = new app.PaintRoller($elem, 'vertical');
  this.stickerDinosaur = new app.Sticker($elem, 'dinosaur');
  this.stickerFishTeal = new app.Sticker($elem, 'fish-teal', 3);
  this.stickerSanta = new app.Sticker($elem, 'santa');
  this.stickerCactus = new app.Sticker($elem, 'cactus');
  this.stickerIgloo = new app.Sticker($elem, 'igloo');
  this.stickerTreePalm = new app.Sticker($elem, 'tree-palm');
  this.stickerBrownBear = new app.Sticker($elem, 'brown-bear');
  this.stickerFishYellow = new app.Sticker($elem, 'fish-yellow', 3);
  this.stickerGingerbreadMan = new app.Sticker($elem, 'gingerbread-man', 1.5);
  this.stickerMrsClaus = new app.Sticker($elem, 'mrs-claus');
  this.stickerNarwhal = new app.Sticker($elem, 'narwhal');
  this.stickerPenguinPresents = new app.Sticker($elem, 'penguin-presents', 2);
  this.stickerRudolphFront = new app.Sticker($elem, 'rudolph-front');
  this.stickerRudolphSide = new app.Sticker($elem, 'rudolph-side');
  this.stickerSantaSled = new app.Sticker($elem, 'santa-sled');
  this.stickerSnowMonster = new app.Sticker($elem, 'snow-monster');
  this.stickerCloud1 = new app.Sticker($elem, 'cloud1');
  this.stickerCloud2 = new app.Sticker($elem, 'cloud2', 3);
  this.stickerCloud3 = new app.Sticker($elem, 'cloud3', 3);
  this.stickerCoralLarge = new app.Sticker($elem, 'coral-large', 4);
  this.stickerCoralMedium = new app.Sticker($elem, 'coral-medium', 4);
  this.stickerCoralSmall = new app.Sticker($elem, 'coral-small', 4);
  this.stickerMoon = new app.Sticker($elem, 'moon');
  this.stickerSeaweedGreen = new app.Sticker($elem, 'seaweed-green', 4);
  this.stickerSeaweedLime = new app.Sticker($elem, 'seaweed-lime', 4);
  this.stickerSun = new app.Sticker($elem, 'sun');
  this.stickerTreeHoliday = new app.Sticker($elem, 'tree-holiday');
  this.stickerTreesBlue = new app.Sticker($elem, 'trees-blue');
  this.stickerTreesGreen = new app.Sticker($elem, 'trees-green');
  this.stickerBeachBall = new app.Sticker($elem, 'beach-ball');
  this.stickerBell = new app.Sticker($elem, 'bell');
  this.stickerCandle = new app.Sticker($elem, 'candle');
  this.stickerClock = new app.Sticker($elem, 'clock');
  this.stickerDiscoBall = new app.Sticker($elem, 'disco-ball');
  this.stickerFirewood = new app.Sticker($elem, 'firewood');
  this.stickerFrame1 = new app.Sticker($elem, 'frame1');
  this.stickerFrame2 = new app.Sticker($elem, 'frame2');
  this.stickerFrame3 = new app.Sticker($elem, 'frame3');
  this.stickerHolly = new app.Sticker($elem, 'holly');
  this.stickerPresentsStack = new app.Sticker($elem, 'presents-stack');
  this.stickerRecordPlayer = new app.Sticker($elem, 'record-player');
  this.stickerRedBow = new app.Sticker($elem, 'red-bow');
  this.stickerShowLights = new app.Sticker($elem, 'show-lights');
  this.stickerSnowglobeSnowman = new app.Sticker($elem, 'snowglobe-snowman');
  this.stickerSnowglobeTree = new app.Sticker($elem, 'snowglobe-tree');
  this.stickerStereo = new app.Sticker($elem, 'stereo');
  this.stickerStockingGreen = new app.Sticker($elem, 'stocking-green');
  this.stickerStockingPink = new app.Sticker($elem, 'stocking-pink');
  this.stickerStockingRed = new app.Sticker($elem, 'stocking-red');
  this.stickerStockingYellow = new app.Sticker($elem, 'stocking-yellow');
  this.stickerTreasureClosed = new app.Sticker($elem, 'treasure-closed');
  this.stickerTreasureOpen = new app.Sticker($elem, 'treasure-open');
  this.stickerWindow = new app.Sticker($elem, 'window');
  this.stickerWreath = new app.Sticker($elem, 'wreath');
  this.stickerElf1 = new app.Sticker($elem, 'elf1');
  this.stickerElf2 = new app.Sticker($elem, 'elf2');
  this.stickerElf3 = new app.Sticker($elem, 'elf3');
  this.stickerElf4 = new app.Sticker($elem, 'elf4');
  this.stickerElf5 = new app.Sticker($elem, 'elf5');
  this.stickerElf6 = new app.Sticker($elem, 'elf6');
  this.stickerElf7 = new app.Sticker($elem, 'elf7');
  this.stickerElf8 = new app.Sticker($elem, 'elf8');
  this.stickerElf9 = new app.Sticker($elem, 'elf9');
  this.stickerElf10 = new app.Sticker($elem, 'elf10');
  this.stickerElf11 = new app.Sticker($elem, 'elf11');
  this.stickerElf12 = new app.Sticker($elem, 'elf12');
  this.stickerElf13 = new app.Sticker($elem, 'elf13');
  this.stickerElf14 = new app.Sticker($elem, 'elf14');
  this.stickerElf15 = new app.Sticker($elem, 'elf15');
  this.stickerElf16 = new app.Sticker($elem, 'elf16');
  this.stickerElf17 = new app.Sticker($elem, 'elf17');
  this.stickerElf18 = new app.Sticker($elem, 'elf18');
  this.stickerElf19 = new app.Sticker($elem, 'elf19');
  this.stickerElf20 = new app.Sticker($elem, 'elf20');
  this.stickerElf21 = new app.Sticker($elem, 'elf21');
  this.stickerElf22 = new app.Sticker($elem, 'elf22');
  this.stickerElf23 = new app.Sticker($elem, 'elf23');
  this.stickerElf24 = new app.Sticker($elem, 'elf24');
  this.stickerElf25 = new app.Sticker($elem, 'elf25');
  this.stickerElf26 = new app.Sticker($elem, 'elf26');
  this.stickerElf27 = new app.Sticker($elem, 'elf27');
  this.stickerElf28 = new app.Sticker($elem, 'elf28');
  this.stickerElf29 = new app.Sticker($elem, 'elf29');
  this.stickerElfDuckFloat = new app.Sticker($elem, 'elf-duck-float');
  this.stickerElfJamGuitar = new app.Sticker($elem, 'elf-jam-guitar');
  this.stickerElfJamSing = new app.Sticker($elem, 'elf-jam-sing');
  this.stickerElfMermaid = new app.Sticker($elem, 'elf-mermaid');
  this.stickerElfMerman = new app.Sticker($elem, 'elf-merman');
  this.stickerElfScuba1 = new app.Sticker($elem, 'elf-scuba1');
  this.stickerElfScuba2 = new app.Sticker($elem, 'elf-scuba2');
  this.stickerElfSeesaw = new app.Sticker($elem, 'elf-seesaw');
  this.stickerCandycaneGreen = new app.Sticker($elem, 'candycane-green');
  this.stickerCookieChocChip = new app.Sticker($elem, 'cookie-choc-chip');
  this.stickerCookieMan = new app.Sticker($elem, 'cookie-man');
  this.stickerFaceEyesGlasses1 = new app.Sticker($elem, 'face-eyes-glasses1');
  this.stickerFaceMouthBlack = new app.Sticker($elem, 'face-mouth-black');
  this.stickerHatBlue = new app.Sticker($elem, 'hat-blue');
  this.stickerHeadElfHair2 = new app.Sticker($elem, 'head-elf-hair2');
  this.stickerElfCar = new app.Sticker($elem, 'elf-car');
  this.stickerHouse = new app.Sticker($elem, 'house');
  this.stickerSantaSleigh = new app.Sticker($elem, 'santa-sleigh');
  this.stickerSchoolBus = new app.Sticker($elem, 'school-bus');
  this.stickerVillageHouses = new app.Sticker($elem, 'village-houses');
  this.stickerCandies = new app.Sticker($elem, 'candies');
  this.stickerCandycaneGreens = new app.Sticker($elem, 'candycane-greens');
  this.stickerCandycaneHoliday = new app.Sticker($elem, 'candycane-holiday');
  this.stickerCandycaneRed = new app.Sticker($elem, 'candycane-red');
  this.stickerCandycaneReds = new app.Sticker($elem, 'candycane-reds');
  this.stickerCandycaneTropical = new app.Sticker($elem, 'candycane-tropical');
  this.stickerCandycornHoliday = new app.Sticker($elem, 'candycorn-holiday');
  this.stickerChocolateGumdrop = new app.Sticker($elem, 'chocolate-gumdrop');
  this.stickerChocolateNuts = new app.Sticker($elem, 'chocolate-nuts');
  this.stickerChocolatePretzel = new app.Sticker($elem, 'chocolate-pretzel');
  this.stickerChocolateSquiggle = new app.Sticker($elem, 'chocolate-squiggle');
  this.stickerChocolateStripes = new app.Sticker($elem, 'chocolate-stripes');
  this.stickerChocolateSwirl = new app.Sticker($elem, 'chocolate-swirl');
  this.stickerCookieKiss = new app.Sticker($elem, 'cookie-kiss');
  this.stickerCookieSnowman = new app.Sticker($elem, 'cookie-snowman');
  this.stickerCookieStocking = new app.Sticker($elem, 'cookie-stocking');
  this.stickerCookieTree = new app.Sticker($elem, 'cookie-tree');
  this.stickerMilk = new app.Sticker($elem, 'milk');
  this.stickerMugGreen = new app.Sticker($elem, 'mug-green');
  this.stickerMugRed = new app.Sticker($elem, 'mug-red');
  this.stickerSantaDance = new app.Sticker($elem, 'santa-dance');
  this.stickerSantaSleep = new app.Sticker($elem, 'santa-sleep');
  this.stickerAstronaut = new app.Sticker($elem, 'astronaut');
  this.stickerBat = new app.Sticker($elem, 'bat', 3);
  this.stickerBoxFish = new app.Sticker($elem, 'box-fish', 3);
  this.stickerBrownBearBaby = new app.Sticker($elem, 'brown-bear-baby', 2);
  this.stickerBrownBearPirate = new app.Sticker($elem, 'brown-bear-pirate');
  this.stickerDolphin = new app.Sticker($elem, 'dolphin', 1.5);
  this.stickerFishPink = new app.Sticker($elem, 'fish-pink', 3);
  this.stickerJellyfish = new app.Sticker($elem, 'jellyfish', 4);
  this.stickerLightFish = new app.Sticker($elem, 'light-fish', 3);
  this.stickerNutcrackerGreen = new app.Sticker($elem, 'nutcracker-green');
  this.stickerPegmanHips = new app.Sticker($elem, 'pegman-hips', 1.5);
  this.stickerPenguinAngry = new app.Sticker($elem, 'penguin-angry', 3);
  this.stickerPolarBearScuba = new app.Sticker($elem, 'polar-bear-scuba');
  this.stickerReindeerBabies = new app.Sticker($elem, 'reindeer-babies');
  this.stickerReindeerBabyBoy = new app.Sticker($elem, 'reindeer-baby-boy', 2);
  this.stickerReindeerBabyGirl = new app.Sticker($elem, 'reindeer-baby-girl', 2);
  this.stickerReindeerWhite = new app.Sticker($elem, 'reindeer-white');
  this.stickerRobotPurple = new app.Sticker($elem, 'robot-purple');
  this.stickerRudolphDancing2 = new app.Sticker($elem, 'rudolph-dancing2');
  this.stickerScubaGreen = new app.Sticker($elem, 'scuba-green');
  this.stickerScubaOrange = new app.Sticker($elem, 'scuba-orange');
  this.stickerSeagullFly2 = new app.Sticker($elem, 'seagull-fly2', 3);
  this.stickerShark = new app.Sticker($elem, 'shark');
  this.stickerSnowmanBigPenguin = new app.Sticker($elem, 'snowman-big-penguin');
  this.stickerSnowmanBigTub = new app.Sticker($elem, 'snowman-big-tub');
  this.stickerWalrus = new app.Sticker($elem, 'walrus', 1.5);
  this.stickerElfHead1 = new app.Sticker($elem, 'elf-head1');
  this.stickerElfHead2 = new app.Sticker($elem, 'elf-head2');
  this.stickerElfHead3 = new app.Sticker($elem, 'elf-head3');
  this.stickerElfHead4 = new app.Sticker($elem, 'elf-head4');
  this.stickerElfHead5 = new app.Sticker($elem, 'elf-head5');
  this.stickerFaceBearMouth = new app.Sticker($elem, 'face-bear-mouth');
  this.stickerFaceCarrotNose = new app.Sticker($elem, 'face-carrot-nose');
  this.stickerFaceEyesGlasses2 = new app.Sticker($elem, 'face-eyes-glasses2');
  this.stickerFaceEyesGlasses3 = new app.Sticker($elem, 'face-eyes-glasses3');
  this.stickerFaceEyesGlasses4 = new app.Sticker($elem, 'face-eyes-glasses4');
  this.stickerFaceEyesGlasses5 = new app.Sticker($elem, 'face-eyes-glasses5');
  this.stickerFaceEyesNormal = new app.Sticker($elem, 'face-eyes-normal');
  this.stickerFaceEyesSunglasses1 = new app.Sticker($elem, 'face-eyes-sunglasses1');
  this.stickerFaceEyesSunglasses2 = new app.Sticker($elem, 'face-eyes-sunglasses2');
  this.stickerFaceEyesSunglasses3 = new app.Sticker($elem, 'face-eyes-sunglasses3');
  this.stickerFaceEyesSunglasses4 = new app.Sticker($elem, 'face-eyes-sunglasses4');
  this.stickerFaceMoustache = new app.Sticker($elem, 'face-moustache');
  this.stickerFaceMouthWhite = new app.Sticker($elem, 'face-mouth-white');
  this.stickerFaceNosePink = new app.Sticker($elem, 'face-nose-pink');
  this.stickerFaceNoseRed = new app.Sticker($elem, 'face-nose-red');
  this.stickerFaceSantaBeard = new app.Sticker($elem, 'face-santa-beard');
  this.stickerFaceTeeth = new app.Sticker($elem, 'face-teeth');
  this.stickerFaceWalrusMouth = new app.Sticker($elem, 'face-walrus-mouth');
  this.stickerHatAntlersBlue = new app.Sticker($elem, 'hat-antlers-blue');
  this.stickerHatAntlersBrown = new app.Sticker($elem, 'hat-antlers-brown');
  this.stickerHatBeanie = new app.Sticker($elem, 'hat-beanie');
  this.stickerHatGreen = new app.Sticker($elem, 'hat-green');
  this.stickerHatOrange = new app.Sticker($elem, 'hat-orange');
  this.stickerHatPink = new app.Sticker($elem, 'hat-pink');
  this.stickerHatPurple = new app.Sticker($elem, 'hat-purple');
  this.stickerHatSanta = new app.Sticker($elem, 'hat-santa');
  this.stickerHatYellow = new app.Sticker($elem, 'hat-yellow');
  this.stickerHeadBear = new app.Sticker($elem, 'head-bear');
  this.stickerHeadElfHair1 = new app.Sticker($elem, 'head-elf-hair1');
  this.stickerHeadElfHair2 = new app.Sticker($elem, 'head-elf-hair2');
  this.stickerHeadElfHair3 = new app.Sticker($elem, 'head-elf-hair3');
  this.stickerHeadElfHair4 = new app.Sticker($elem, 'head-elf-hair4');
  this.stickerHeadElfHair5 = new app.Sticker($elem, 'head-elf-hair5');
  this.stickerHeadElfHair6 = new app.Sticker($elem, 'head-elf-hair6');
  this.stickerHeadElfHair7 = new app.Sticker($elem, 'head-elf-hair7');
  this.stickerHeadElfHair8 = new app.Sticker($elem, 'head-elf-hair8');
  this.stickerHeadElfHair9 = new app.Sticker($elem, 'head-elf-hair9');
  this.stickerHeadElfHair10 = new app.Sticker($elem, 'head-elf-hair10');
  this.stickerHeadReindeer = new app.Sticker($elem, 'head-reindeer');


  this.tools = [
    this.pencil,
    this.crayon,
    this.marker,
    this.paintbrush,
    this.tinsel,
    this.icing,
    this.garland,
    this.neon,
    this.bell,
    this.hangingLights,
    this.stringLights,
    this.spray,
    this.spraySprinkles,
    this.sprayCandy,
    this.sprayConfetti,
    this.sprayHoliday,
    this.sprayOcean,
    this.sprayOrnaments,
    this.spraySnow,
    this.spraySnowflakes,
    this.sceneAir,
    this.sceneAirport,
    this.sceneBeach,
    this.sceneDock,
    this.sceneIceberg,
    this.sceneLivingroom,
    this.sceneNight,
    this.sceneNone,
    this.sceneSnow,
    this.sceneUnderwater,
    this.eraser,
    this.eraserMobile,
    this.shapeCircle,
    this.shapeDiamond,
    this.shapeHeart,
    this.shapeOctagon,
    this.shapePentagon,
    this.shapeRectangle,
    this.shapeSquare,
    this.shapeStar,
    this.shapeTriangle,
    this.stampBow,
    this.stampPresent,
    this.stampOrnamentRound1,
    this.stampOrnamentRound2,
    this.stampOrnamentRound3,
    this.stampOrnamentSkinny1,
    this.stampOrnamentSkinny2,
    this.stampOrnamentWide1,
    this.stampOrnamentWide2,
    this.stampCandyGumdrop,
    this.stampCandyJellybean,
    this.stampCandyMintSwirl,
    this.stampCandyMintWheel,
    this.stampCandySucker,
    this.stampCandyWrapper1,
    this.stampCandyWrapper2,
    this.rollerCheckered,
    this.rollerDiagonal,
    this.rollerHorizontal,
    this.rollerPolkadots,
    this.rollerSnowflakes,
    this.rollerTrees,
    this.rollerVertical,
    this.stickerBrownBear,
    this.stickerDinosaur,
    this.stickerFishTeal,
    this.stickerFishYellow,
    this.stickerGingerbreadMan,
    this.stickerMrsClaus,
    this.stickerNarwhal,
    this.stickerPenguinPresents,
    this.stickerRudolphFront,
    this.stickerRudolphSide,
    this.stickerSantaSled,
    this.stickerSanta,
    this.stickerSnowMonster,
    this.stickerCactus,
    this.stickerCloud1,
    this.stickerCloud2,
    this.stickerCloud3,
    this.stickerCoralLarge,
    this.stickerCoralMedium,
    this.stickerCoralSmall,
    this.stickerIgloo,
    this.stickerMoon,
    this.stickerSeaweedGreen,
    this.stickerSeaweedLime,
    this.stickerSun,
    this.stickerTreeHoliday,
    this.stickerTreePalm,
    this.stickerTreesBlue,
    this.stickerTreesGreen,
    this.stickerBeachBall,
    this.stickerBell,
    this.stickerCandle,
    this.stickerClock,
    this.stickerDiscoBall,
    this.stickerFirewood,
    this.stickerFrame1,
    this.stickerFrame2,
    this.stickerFrame3,
    this.stickerHolly,
    this.stickerPresentsStack,
    this.stickerRecordPlayer,
    this.stickerRedBow,
    this.stickerShowLights,
    this.stickerSnowglobeSnowman,
    this.stickerSnowglobeTree,
    this.stickerStereo,
    this.stickerStockingGreen,
    this.stickerStockingPink,
    this.stickerStockingRed,
    this.stickerStockingYellow,
    this.stickerTreasureClosed,
    this.stickerTreasureOpen,
    this.stickerWindow,
    this.stickerWreath,
    this.stickerElf1,
    this.stickerElf2,
    this.stickerElf3,
    this.stickerElf4,
    this.stickerElf5,
    this.stickerElf6,
    this.stickerElf7,
    this.stickerElf8,
    this.stickerElf9,
    this.stickerElf10,
    this.stickerElf11,
    this.stickerElf12,
    this.stickerElf13,
    this.stickerElf14,
    this.stickerElf15,
    this.stickerElf16,
    this.stickerElf17,
    this.stickerElf18,
    this.stickerElf19,
    this.stickerElf20,
    this.stickerElf21,
    this.stickerElf22,
    this.stickerElf23,
    this.stickerElf24,
    this.stickerElf25,
    this.stickerElf26,
    this.stickerElf27,
    this.stickerElf28,
    this.stickerElf29,
    this.stickerElfDuckFloat,
    this.stickerElfJamGuitar,
    this.stickerElfJamSing,
    this.stickerElfMermaid,
    this.stickerElfMerman,
    this.stickerElfScuba1,
    this.stickerElfScuba2,
    this.stickerElfSeesaw,
    this.stickerCandycaneGreen,
    this.stickerCookieChocChip,
    this.stickerCookieMan,
    this.stickerFaceEyesGlasses1,
    this.stickerFaceMouthBlack,
    this.stickerHatBlue,
    this.stickerHeadElfHair2,
    this.stickerElfCar,
    this.stickerHouse,
    this.stickerSantaSleigh,
    this.stickerSchoolBus,
    this.stickerVillageHouses,
    this.stickerCandies,
    this.stickerCandycaneGreens,
    this.stickerCandycaneHoliday,
    this.stickerCandycaneRed,
    this.stickerCandycaneReds,
    this.stickerCandycaneTropical,
    this.stickerCandycornHoliday,
    this.stickerChocolateGumdrop,
    this.stickerChocolateNuts,
    this.stickerChocolatePretzel,
    this.stickerChocolateSquiggle,
    this.stickerChocolateStripes,
    this.stickerChocolateSwirl,
    this.stickerCookieKiss,
    this.stickerCookieSnowman,
    this.stickerCookieStocking,
    this.stickerCookieTree,
    this.stickerMilk,
    this.stickerMugGreen,
    this.stickerMugRed,
    this.stickerSantaDance,
    this.stickerSantaSleep,
    this.stickerAstronaut,
    this.stickerBat,
    this.stickerBoxFish,
    this.stickerBrownBearBaby,
    this.stickerBrownBearPirate,
    this.stickerDolphin,
    this.stickerFishPink,
    this.stickerJellyfish,
    this.stickerLightFish,
    this.stickerNutcrackerGreen,
    this.stickerPegmanHips,
    this.stickerPenguinAngry,
    this.stickerPolarBearScuba,
    this.stickerReindeerBabies,
    this.stickerReindeerBabyBoy,
    this.stickerReindeerBabyGirl,
    this.stickerReindeerWhite,
    this.stickerRobotPurple,
    this.stickerRudolphDancing2,
    this.stickerScubaGreen,
    this.stickerScubaOrange,
    this.stickerSeagullFly2,
    this.stickerShark,
    this.stickerSnowmanBigPenguin,
    this.stickerSnowmanBigTub,
    this.stickerWalrus,
    this.stickerElfHead1,
    this.stickerElfHead2,
    this.stickerElfHead3,
    this.stickerElfHead4,
    this.stickerElfHead5,
    this.stickerFaceBearMouth,
    this.stickerFaceCarrotNose,
    this.stickerFaceEyesGlasses2,
    this.stickerFaceEyesGlasses3,
    this.stickerFaceEyesGlasses4,
    this.stickerFaceEyesGlasses5,
    this.stickerFaceEyesNormal,
    this.stickerFaceEyesSunglasses1,
    this.stickerFaceEyesSunglasses2,
    this.stickerFaceEyesSunglasses3,
    this.stickerFaceEyesSunglasses4,
    this.stickerFaceMoustache,
    this.stickerFaceMouthWhite,
    this.stickerFaceNosePink,
    this.stickerFaceNoseRed,
    this.stickerFaceSantaBeard,
    this.stickerFaceTeeth,
    this.stickerFaceWalrusMouth,
    this.stickerHatAntlersBlue,
    this.stickerHatAntlersBrown,
    this.stickerHatBeanie,
    this.stickerHatGreen,
    this.stickerHatOrange,
    this.stickerHatPink,
    this.stickerHatPurple,
    this.stickerHatSanta,
    this.stickerHatYellow,
    this.stickerHeadBear,
    this.stickerHeadElfHair1,
    this.stickerHeadElfHair2,
    this.stickerHeadElfHair3,
    this.stickerHeadElfHair4,
    this.stickerHeadElfHair5,
    this.stickerHeadElfHair6,
    this.stickerHeadElfHair7,
    this.stickerHeadElfHair8,
    this.stickerHeadElfHair9,
    this.stickerHeadElfHair10,
    this.stickerHeadReindeer
  ];
};


/**
 * Starts the tools
 */
app.Tools.prototype.start = function() {
  this.selectTool_ = this.selectTool_.bind(this);
  this.secondaryMenu.on('click.santascanvas touchend.santascanvas',
      this.selectTool_);

  this.onResize();
  $(window).on('resize.santascanvas', this.onResize.bind(this));
};


/**
 * Mouse changed handler
 * @param {!app.Mouse} mouse
 * @param {app.Mouse.CoordsType} mouseCoords transformed coords
 */
app.Tools.prototype.mouseChanged = function(mouse, mouseCoords) {
  if (this.selectedTool) {
    this.selectedTool.move(mouseCoords);

    if (mouseCoords.down) {
      this.selectedTool.startMousedown();

      var insideCanvas = this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.game_.canvas.displayCanvas) &&
        !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.primaryMenu[0]) &&
        !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.secondaryMenu[0]) &&
        !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.game_.colorpicker.popup[0]) &&
        !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.mobileEdit[0]) &&
        !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.mobileSlider[0]);

      var startedOnSlider = $(this.game_.mouse.originalTarget).closest('[data-slider]').length;

      if (app.shared.utils.touchEnabled && insideCanvas && !startedOnSlider) {
        this.game_.sceneElem.addClass('ui-hidden');

        if (this.game_.colorpicker.isPopupOpen()) {
          this.game_.colorpicker.togglePopup();
        }
      }

      if (this.secondaryMenuActive && !app.shared.utils.touchEnabled &&
          this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.game_.canvas.displayCanvas) &&
          !this.game_.mouse.isInsideEl(mouse.x, mouse.y, this.secondaryMenu[0])) {
        this.secondaryMenu.removeClass('is-active');

        if (this.game_.colorpicker.isPopupOpen()) {
          this.game_.colorpicker.togglePopup();
        }
      }
    } else {
      this.selectedTool.stopMousedown();

      if (!app.shared.utils.touchEnabled && this.secondaryMenuActive) {
        this.secondaryMenu.addClass('is-active');
      }

      if (app.shared.utils.touchEnabled) {
        this.game_.sceneElem.removeClass('ui-hidden');
      }
    }
  }
};


/**
 * Handle clicks on the toolbox to select a tool
 * @param {!Event} e DOM click event
 * @private
 */
app.Tools.prototype.selectTool_ = function(e) {
  // Check if on slider or rotator
  if ($(e.target).closest('[data-slider]').length ||
    $(e.target).closest('[data-rotator]').length) {
    return;
  }

  var previousTool = this.selectedTool;

  if (previousTool) {
    previousTool.deselect();
  }

  this.selectedTool = this.tools.filter(function(tool) {
    var target = $(e.target).closest('[data-tool]');
    if (tool.el[0] === target[0] && !tool.isSelected) {
      return tool;
    }
  })[0];

  if (this.selectedTool) {
    if (app.LayerTool.prototype.isPrototypeOf(this.selectedTool)) {
      this.selectedTool.draw();
      this.selectedTool = null;
      this.toolDisplay.attr('data-current-tool', '');
      this.toolDisplay.attr('data-current-category', '');

      if (app.shared.utils.touchEnabled) {
        this.currentCategory = null;
        this.secondaryMenuActive = false;
        this.categoryPickers.removeClass('is-active');
        this.secondaryMenu.removeClass('is-active');
      }
    } else {
      if (this.selectedTool != previousTool) {
        var coords = this.game_.mouse.coordinates();
        this.selectedTool.preloadImage(this.game_.colorpicker.selectedColor);
        this.selectedTool.select(coords);
        this.sliderChanged(this.game_.slider.size);
        this.toolDisplay.attr('data-current-tool', this.selectedTool.name);

        if (app.shared.utils.touchEnabled) {
          this.secondaryMenu.removeClass('is-active');
        }
      } else {
        this.selectedTool = null;
        this.toolDisplay.attr('data-current-tool', '');
      }
    }
  }
};


app.Tools.prototype.drawToCanvas = function(selectedTool) {
  this.game_.canvas.updateCanvas(selectedTool, selectedTool.draw);
  this.game_.canvas.save();
  this.game_.canvas.needSave = false;
};


app.Tools.prototype.onCategoryClick_ = function(e) {
  var categoryPicker = $(e.target).closest('[data-tool-category-picker]');
  var categoryName = categoryPicker.attr('data-tool-category');
  var categoryMenu = this.secondaryMenu.find('[data-tool-category="' + categoryName + '"]');

  if (this.currentCategory && this.currentCategory == categoryName) {
    if (app.shared.utils.touchEnabled) {
      if (this.secondaryMenuActive) {
        if (!this.selectedTool) {
          categoryPicker.toggleClass('is-active');
          this.currentCategory = null;
          this.toolDisplay.attr('data-current-category', '');
        }
        this.secondaryMenu.toggleClass('is-active');
      }

      if (categoryName == 'eraser') {
        categoryPicker.removeClass('is-active');
        this.currentCategory = null;
        this.selectedTool.deselect();
        this.selectedTool = null;
      }
    }

    return;
  }

  if (this.game_.colorpicker.isPopupOpen()) {
    this.game_.colorpicker.togglePopup();
  }

  this.categoryPickers.removeClass('is-active');
  this.categoryMenus.removeClass('is-active');
  categoryPicker.addClass('is-active');
  this.currentCategory = categoryName;
  this.toolDisplay.attr('data-current-category', this.currentCategory);

  if (this.selectedTool) {
    this.selectedTool.deselect();
    this.selectedTool = null;
  }

  if (categoryName == 'eraser') {
    this.secondaryMenuActive = false;
    this.secondaryMenu.removeClass('is-active');
    this.selectTool_(e);
  } else {
    this.secondaryMenuActive = true;
    this.secondaryMenu.addClass('is-active');
    categoryMenu.addClass('is-active');
  }
};


app.Tools.prototype.onSubcategoryClick_ = function(e) {
  var subcategoryPicker = $(e.target).closest('[data-tool-subcategory-picker]');
  var subcategoryName = subcategoryPicker.attr('data-tool-subcategory');
  var subcategoryMenu = this.secondaryMenu.find('[data-tool-subcategory="' + subcategoryName + '"]');

  this.subcategoryPickers.removeClass('is-active');
  this.subcategoryMenus.removeClass('is-active');
  subcategoryMenu.addClass('is-active');
  subcategoryPicker.addClass('is-active');

  this.onResize();
};


app.Tools.prototype.sliderChanged = function(size) {
  if (this.selectedTool) {
    this.selectedTool.updateSize(size);
    this.circleSize = this.selectedTool.currentSize *
        this.game_.canvas.canvasRatio;

    this.selectedTool.circleEl.css({
      height: this.circleSize,
      width: this.circleSize
    });

    this.selectedTool.mouseOffset = {
      x: -this.circleSize / 2,
      y: this.circleSize / 2
    };
  }
};


app.Tools.prototype.rotatorChanged = function(angle) {
  if (this.selectedTool) {
    this.selectedTool.updateAngle(angle);
  }
};


app.Tools.prototype.colorChanged = function(color) {
  if (this.selectedTool) {
    this.selectedTool.preloadImage(color);
  }
};


app.Tools.prototype.onNavClick_ = function(e) {
  var menu = $(e.target).closest('[data-tool-category-tray]');
  var direction = $(e.target).attr('data-tool-nav') === 'next' ? 1 : -1;
  var offset = direction * 130 * 2; // width of 2 tools

  menu.animate({
    scrollLeft: menu.scrollLeft() + offset
  }, 300);
};


app.Tools.prototype.onResize = function() {
  this.categoryMenuNavs.each(function() {
    var menu = $(this).closest('[data-tool-category-tray]');
    var outerWidth = menu[0].getBoundingClientRect().width;

    if (menu[0] && menu[0].scrollWidth > outerWidth) {
      $(this).addClass('is-active');
    } else {
      $(this).removeClass('is-active');
    }
  });
};
