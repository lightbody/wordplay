use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rand::thread_rng;
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::error::AppError;
use crate::{
    auth::AuthUser,
    engine::{
        board::Board,
        endgame::{self, EndReason},
        moves::{validate_play, PlayError},
        tiles::{self, RACK_SIZE},
    },
    models::{Game, Move, MoveRequest, GAME_COLUMNS, MOVE_COLUMNS},
    AppState,
};

pub async fn make_move(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<MoveRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let mut tx = state.pool.begin().await?;

    let game = sqlx::query_as::<_, Game>(&format!(
        "SELECT {GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    let am_creator = game.creator_id == user_id;
    let is_participant = am_creator || game.opponent_id.as_deref() == Some(&user_id);
    if !is_participant {
        return Err(AppError::Forbidden);
    }
    if game.status != "active" {
        return Err(AppError::conflict("game_not_active"));
    }
    if game.current_player_id.as_deref() != Some(&user_id) {
        return Err(AppError::conflict("not_your_turn"));
    }

    let opponent_id = if am_creator {
        game.opponent_id.clone().expect("active game has opponent")
    } else {
        game.creator_id.clone()
    };

    // --- Resign short-circuits everything ---
    if matches!(req, MoveRequest::Resign) {
        let move_number = game.move_count + 1;
        insert_move(&mut tx, id, &user_id, move_number, "resign", None, None, None, 0).await?;
        let finished = sqlx::query_as::<_, Game>(&format!(
            "UPDATE games SET status = 'finished', ended_reason = 'resigned',
                 winner_id = $1, current_player_id = NULL, move_count = $2, updated_at = now()
             WHERE id = $3 RETURNING {GAME_COLUMNS}"
        ))
        .bind(&opponent_id)
        .bind(move_number)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(json!({ "game": finished, "move": null_move(finished.move_count), "game_over": true }))));
    }

    // Load the mover's secret rack and the bag.
    let mut rack: String =
        sqlx::query_scalar("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2")
            .bind(id)
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await?;
    let mut bag: String =
        sqlx::query_scalar("SELECT bag FROM game_secrets WHERE game_id = $1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;

    let mut board = Board::from_str(&game.board).ok_or(AppError::bad_request("corrupt_board"))?;

    // Apply the move to local state; capture the DB-facing pieces.
    let mut score = 0;
    let mut move_scored = false;
    let move_type;
    let mut tiles_json: Option<serde_json::Value> = None;
    let mut words_json: Option<serde_json::Value> = None;
    let mut swap_count: Option<i32> = None;

    match req {
        MoveRequest::Play { tiles } => {
            move_type = "play";
            let outcome = validate_play(&board, &rack, &tiles).map_err(play_error)?;
            board = outcome.new_board;
            rack = outcome.remaining_rack;
            tiles::draw(&mut bag, &mut rack);
            score = outcome.total;
            move_scored = score > 0;
            tiles_json = Some(serde_json::to_value(&tiles).unwrap());
            words_json = Some(serde_json::to_value(&outcome.words).unwrap());
        }
        MoveRequest::Swap { letters } => {
            move_type = "swap";
            let count = letters.chars().count();
            if count == 0 || count > RACK_SIZE {
                return Err(AppError::bad_request("invalid_swap_count"));
            }
            // Standard rule: swapping requires a reasonably full bag.
            if game.tiles_remaining < RACK_SIZE as i32 {
                return Err(AppError::conflict("bag_too_small_to_swap"));
            }
            tiles::swap_tiles(&mut bag, &mut rack, &letters, &mut thread_rng())
                .map_err(|c| AppError::unprocessable("not_in_rack", Some(json!({ "letter": c.to_string() }))))?;
            swap_count = Some(count as i32);
        }
        MoveRequest::Pass => {
            move_type = "pass";
        }
        MoveRequest::Resign => unreachable!(),
    }

    let next_player = opponent_id.clone();
    let next_rack_empty: bool = {
        let n: Option<i64> = sqlx::query_scalar(
            "SELECT length(rack) FROM game_players WHERE game_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(&next_player)
        .fetch_optional(&mut *tx)
        .await?;
        n.map(|l| l == 0).unwrap_or(false)
    };

    let bag_empty = bag.is_empty();
    let turn = endgame::evaluate(
        bag_empty,
        game.final_moves_remaining,
        game.scoreless_streak,
        move_scored,
        next_rack_empty,
    );

    // Persist the mover's rack and the bag.
    sqlx::query("UPDATE game_players SET rack = $1, updated_at = now() WHERE game_id = $2 AND user_id = $3")
        .bind(&rack)
        .bind(id)
        .bind(&user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE game_secrets SET bag = $1 WHERE game_id = $2")
        .bind(&bag)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    let move_number = game.move_count + 1;
    let mv = insert_move(
        &mut tx, id, &user_id, move_number, move_type, tiles_json, words_json, swap_count, score,
    )
    .await?;

    // Column names for the mover's score/rack-count.
    let (score_col, rack_col) = if am_creator {
        ("creator_score", "creator_rack_count")
    } else {
        ("opponent_score", "opponent_rack_count")
    };

    // Apply the shared game-state update.
    let current_player = if turn.finished.is_some() {
        None
    } else {
        Some(next_player.clone())
    };

    sqlx::query(&format!(
        "UPDATE games SET board = $1, tiles_remaining = $2, {score_col} = {score_col} + $3,
             {rack_col} = $4, move_count = $5, scoreless_streak = $6,
             final_moves_remaining = $7, current_player_id = $8, updated_at = now()
         WHERE id = $9"
    ))
    .bind(board.to_string())
    .bind(bag.chars().count() as i32)
    .bind(score)
    .bind(rack.chars().count() as i32)
    .bind(move_number)
    .bind(turn.scoreless_streak)
    .bind(turn.final_moves_remaining)
    .bind(current_player)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    let game_over = turn.finished.is_some();
    let updated = if let Some(reason) = turn.finished {
        finalize(&mut tx, id, &game, reason).await?
    } else {
        sqlx::query_as::<_, Game>(&format!("SELECT {GAME_COLUMNS} FROM games WHERE id = $1"))
            .bind(id)
            .fetch_one(&mut *tx)
            .await?
    };

    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "game": updated, "move": mv, "rack": rack, "game_over": game_over })),
    ))
}

/// Finalize a game that ended for a non-resign reason: apply unused-tile
/// adjustments (if the option is on) and decide the winner.
async fn finalize(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    game: &Game,
    reason: EndReason,
) -> Result<Game, AppError> {
    let opponent_id = game.opponent_id.clone().unwrap_or_default();

    let creator_rack: String =
        sqlx::query_scalar("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2")
            .bind(id)
            .bind(&game.creator_id)
            .fetch_one(&mut **tx)
            .await?;
    let opponent_rack: String =
        sqlx::query_scalar("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2")
            .bind(id)
            .bind(&opponent_id)
            .fetch_optional(&mut **tx)
            .await?
            .unwrap_or_default();

    let creator_adj = endgame::adjustment(game.deduct_unused, &creator_rack);
    let opponent_adj = endgame::adjustment(game.deduct_unused, &opponent_rack);

    // Current scores (this move's delta is already applied on the row).
    let (creator_score, opponent_score): (i32, i32) =
        sqlx::query_as("SELECT creator_score, opponent_score FROM games WHERE id = $1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;

    let creator_total = creator_score + creator_adj;
    let opponent_total = opponent_score + opponent_adj;
    let winner = endgame::winner(&game.creator_id, &opponent_id, creator_total, opponent_total);

    let updated = sqlx::query_as::<_, Game>(&format!(
        "UPDATE games SET status = 'finished', ended_reason = $1, winner_id = $2,
             creator_adjustment = $3, opponent_adjustment = $4,
             current_player_id = NULL, updated_at = now()
         WHERE id = $5 RETURNING {GAME_COLUMNS}"
    ))
    .bind(reason.as_str())
    .bind(winner)
    .bind(creator_adj)
    .bind(opponent_adj)
    .bind(id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(updated)
}

#[allow(clippy::too_many_arguments)]
async fn insert_move(
    tx: &mut Transaction<'_, Postgres>,
    game_id: Uuid,
    user_id: &str,
    move_number: i32,
    move_type: &str,
    tiles: Option<serde_json::Value>,
    words: Option<serde_json::Value>,
    swap_count: Option<i32>,
    score: i32,
) -> Result<Move, AppError> {
    let mv = sqlx::query_as::<_, Move>(&format!(
        "INSERT INTO moves (game_id, user_id, move_number, move_type, tiles, words, swap_count, score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING {MOVE_COLUMNS}"
    ))
    .bind(game_id)
    .bind(user_id)
    .bind(move_number)
    .bind(move_type)
    .bind(tiles)
    .bind(words)
    .bind(swap_count)
    .bind(score)
    .fetch_one(&mut **tx)
    .await?;
    Ok(mv)
}

fn null_move(move_number: i32) -> serde_json::Value {
    json!({ "move_number": move_number, "move_type": "resign" })
}

fn play_error(e: PlayError) -> AppError {
    match e {
        PlayError::InvalidWords(words) => {
            AppError::unprocessable("invalid_words", Some(json!({ "words": words })))
        }
        other => AppError::unprocessable(other.code(), None),
    }
}
